'use strict'

import { commands, window, workspace, ExtensionContext, Position, Range, Selection, TextDocument, TextLine } from 'vscode';
import * as vscode from 'vscode';

export function activate(context: ExtensionContext) {
    context.subscriptions.push(
        commands.registerCommand('markdown.extension.onEnterKey', onEnterKey),
        commands.registerCommand('markdown.extension.onCtrlEnterKey', () => { onEnterKey('ctrl'); }),
        commands.registerCommand('markdown.extension.onTabKey', onTabKey),
        commands.registerCommand('markdown.extension.onBackspaceKey', onBackspaceKey),
        commands.registerCommand('markdown.extension.checkTaskList', checkTaskList),
        commands.registerCommand('markdown.extension.onMoveLineDown', onMoveLineDown),
        commands.registerCommand('markdown.extension.onMoveLineUp', onMoveLineUp)
    );
}

function isInFencedCodeBlock(doc: TextDocument, lineNum: number): boolean {
    let textBefore = doc.getText(new Range(new Position(0, 0), new Position(lineNum, 0)));
    let matches = textBefore.match(/```.*\r?\n/g);
    if (matches == null) {
        return false;
    } else {
        return matches.length % 2 != 0;
    }
}

async function onEnterKey(modifiers?: string) {
    let editor = window.activeTextEditor;
    let cursorPos: Position = editor.selection.active;
    let line = editor.document.lineAt(cursorPos.line);
    let textBeforeCursor = line.text.substr(0, cursorPos.character);
    let textAfterCursor = line.text.substr(cursorPos.character);

    let lineBreakPos = cursorPos;
    if (modifiers == 'ctrl') {
        lineBreakPos = line.range.end;
    }

    if (isInFencedCodeBlock(editor.document, cursorPos.line)) {
        return asNormal('enter', modifiers);
    }

    // If it's an empty list item, remove it
    if (/^(>|([-+*]|[0-9]+[.)])(| \[[ x]\]))$/.test(textBeforeCursor.trim()) && textAfterCursor.trim().length == 0) {
        return editor.edit(editBuilder => {
            editBuilder.delete(line.range);
            editBuilder.insert(line.range.end, '\n');
        });
    }

    let matches;
    if (/^> /.test(textBeforeCursor)) {
        // Quote block
        await editor.edit(editBuilder => {
            editBuilder.insert(lineBreakPos, `\n> `);
        });
        // Fix cursor position
        if (modifiers == 'ctrl' && !cursorPos.isEqual(lineBreakPos)) {
            let newCursorPos = cursorPos.with(line.lineNumber + 1, 2);
            editor.selection = new Selection(newCursorPos, newCursorPos);
        }
    } else if ((matches = /^(\s*[-+*] +(|\[[ x]\] +))(?!\[[ x]\]).*$/.exec(textBeforeCursor)) !== null) {
        // Unordered list
        await editor.edit(editBuilder => {
            editBuilder.insert(lineBreakPos, `\n${matches[1].replace('[x]', '[ ]')}`);
        });
        // Fix cursor position
        if (modifiers == 'ctrl' && !cursorPos.isEqual(lineBreakPos)) {
            let newCursorPos = cursorPos.with(line.lineNumber + 1, matches[1].length);
            editor.selection = new Selection(newCursorPos, newCursorPos);
        }
    } else if ((matches = /^(\s*)([0-9]+)([.)])( +)(|\[[ x]\] +)(?!\[[ x]\]).*$/.exec(textBeforeCursor)) !== null) {
        // Ordered list
        let config = workspace.getConfiguration('markdown.extension.orderedList').get<string>('marker');
        let marker = '1';
        let leadingSpace = matches[1];
        let previousMarker = matches[2];
        let delimiter = matches[3];
        let trailingSpace = matches[4];
        let gfmCheckbox = matches[5].replace('[x]', '[ ]');
        let textIndent = (previousMarker + delimiter + trailingSpace).length;
        if (config == 'ordered') {
            marker = String(Number(previousMarker) + 1);
        }
        // Add enough trailing spaces so that the text is aligned with the previous list item, but always keep at least one space
        trailingSpace = " ".repeat(Math.max(1, textIndent - (marker + delimiter).length));

        const toBeAdded = leadingSpace + marker + delimiter + trailingSpace + gfmCheckbox;
        await editor.edit(editBuilder => {
            editBuilder.insert(lineBreakPos, `\n${toBeAdded}`);
        });
        // Fix cursor position
        if (modifiers == 'ctrl' && !cursorPos.isEqual(lineBreakPos)) {
            let newCursorPos = cursorPos.with(line.lineNumber + 1, toBeAdded.length);
            editor.selection = new Selection(newCursorPos, newCursorPos);
        }
    } else {
        return asNormal('enter', modifiers);
    }
    editor.revealRange(editor.selection);
}

function onTabKey() {
    let editor = window.activeTextEditor;
    let cursorPos = editor.selection.active;
    let textBeforeCursor = editor.document.lineAt(cursorPos.line).text.substr(0, cursorPos.character);

    if (isInFencedCodeBlock(editor.document, cursorPos.line)) {
        return asNormal('tab');
    }

    if (/^\s*([-+*]|[0-9]+[.)]) +(|\[[ x]\] +)$/.test(textBeforeCursor)) {
        return commands.executeCommand('editor.action.indentLines').then(() => fixMarker(editor, cursorPos.line));
    } else {
        return asNormal('tab');
    }
}

function onBackspaceKey() {
    let editor = window.activeTextEditor
    let cursor = editor.selection.active;
    let document = editor.document;
    let textBeforeCursor = document.lineAt(cursor.line).text.substr(0, cursor.character);

    if (isInFencedCodeBlock(document, cursor.line)) {
        return asNormal('backspace');
    }

    if (/^\s+([-+*]|[0-9]+[.)]) (|\[[ x]\] )$/.test(textBeforeCursor)) {
        return commands.executeCommand('editor.action.outdentLines').then(() => fixMarker(editor, cursor.line));
    } else if (/^([-+*]|[0-9]+[.)]) $/.test(textBeforeCursor)) {
        // e.g. textBeforeCursor == '- ', '1. '
        return deleteRange(editor, new Range(cursor.with({ character: 0 }), cursor));
    } else if (/^([-+*]|[0-9]+[.)]) (\[[ x]\] )$/.test(textBeforeCursor)) {
        // e.g. textBeforeCursor == '- [ ]', '1. [x]'
        return deleteRange(editor, new Range(cursor.with({ character: textBeforeCursor.length - 4 }), cursor));
    } else {
        return asNormal('backspace');
    }
}

function asNormal(key: string, modifiers?: string) {
    switch (key) {
        case 'enter':
            if (modifiers === 'ctrl') {
                return commands.executeCommand('editor.action.insertLineAfter');
            } else {
                return commands.executeCommand('type', { source: 'keyboard', text: '\n' });
            }
        case 'tab':
            if (workspace.getConfiguration('emmet').get<boolean>('triggerExpansionOnTab')) {
                return commands.executeCommand('editor.emmet.action.expandAbbreviation');
            } else {
                return commands.executeCommand('tab');
            }
        case 'backspace':
            return commands.executeCommand('deleteLeft');
    }
}

function lookUpwardForMarker(editor: vscode.TextEditor, line: number, numOfSpaces: number): number {
    let orderedListRegex = /^(\s*)([0-9]+)[.)] +(?:|\[[x]\] +)(?!\[[x]\]).*$/;
    while (--line >= 0) {
        let matches;
        const lineText = editor.document.lineAt(line).text;
        if ((matches = orderedListRegex.exec(lineText)) !== null) {
            if (matches[1].length === numOfSpaces) {
                return Number(matches[2]) + 1;
            } else if ((editor.options.insertSpaces && matches[1].length + editor.options.tabSize <= numOfSpaces)
                || !editor.options.insertSpaces && matches[1].length + 1 <= numOfSpaces) {
                return 1;
            }
        } else if (!lineText.startsWith(' ') && !lineText.startsWith('\\t')) {
            break;
        }
    }
    return 1;
}

/**
 * Fix ordered list marker *iteratively* starting from current line
 */
function fixMarker(editor: vscode.TextEditor, line: number, undoStopBefore = true) {
    if (line < 0 || editor.document.lineCount <= line) {
        return editor.edit(() => { }, { undoStopBefore: false, undoStopAfter: true });
    }

    let currentLineText = editor.document.lineAt(line).text;
    if (/^(\s*[-+*] +(|\[[ x]\] +))(?!\[[ x]\]).*$/.test(currentLineText) // unordered list
        || workspace.getConfiguration('markdown.extension.orderedList').get<string>('marker') == 'one') {
        return editor.edit(() => { }, { undoStopBefore: false, undoStopAfter: true });
    } else {
        let matches;
        if ((matches = /^(\s*)([0-9]+)[.)] +(?:|\[[x]\] +)(?!\[[x]\]).*$/.exec(currentLineText)) !== null) {
            let leadingSpace = matches[1];
            let marker = matches[2];
            let fixedMarker = lookUpwardForMarker(editor, line, leadingSpace.length);

            return editor.edit(editBuilder => {
                if (Number(marker) === fixedMarker) return;
                editBuilder.replace(new Range(line, leadingSpace.length, line, leadingSpace.length + marker.length), String(fixedMarker));
            }, { undoStopBefore: undoStopBefore, undoStopAfter: false }).then(() => {
                let nextLine = line + 1;
                while (editor.document.lineCount > nextLine) {
                    const nextLineText = editor.document.lineAt(nextLine).text;
                    if (/^(\s*)([0-9]+)[.)] +(?:|\[[x]\] +)(?!\[[x]\]).*$/.test(nextLineText)) {
                        return fixMarker(editor, nextLine, false);
                    } else if (nextLineText.startsWith(leadingSpace) && /[ \t]/.test(nextLineText.charAt(leadingSpace.length))) {
                        nextLine++;
                    } else {
                        return editor.edit(() => { }, { undoStopBefore: false, undoStopAfter: true });
                    }
                }
            });
        }
    }
}

function deleteRange(editor: vscode.TextEditor, range: Range): Thenable<boolean> {
    return editor.edit(editBuilder => {
        editBuilder.delete(range);
    });
}

function checkTaskList() {
    let editor = window.activeTextEditor;
    let cursorPos = editor.selection.active;
    let line = editor.document.lineAt(cursorPos.line).text;

    let matches;
    if (matches = /^(\s*([-+*]|[0-9]+[.)]) \[) \]/.exec(line)) {
        return editor.edit(editBuilder => {
            editBuilder.replace(new Range(cursorPos.with({ character: matches[1].length }), cursorPos.with({ character: matches[1].length + 1 })), 'x');
        });
    } else if (matches = /^(\s*([-+*]|[0-9]+[.)]) \[)x\]/.exec(line)) {
        return editor.edit(editBuilder => {
            editBuilder.replace(new Range(cursorPos.with({ character: matches[1].length }), cursorPos.with({ character: matches[1].length + 1 })), ' ');
        });
    }
}

function onMoveLineUp() {
    let editor = vscode.window.activeTextEditor;
    const line = editor.selection.active.line;
    return commands.executeCommand('editor.action.moveLinesUpAction')
        .then(() => fixMarker(editor, line - 1));
}

function onMoveLineDown() {
    let editor = vscode.window.activeTextEditor;
    const line = editor.selection.active.line;
    return commands.executeCommand('editor.action.moveLinesDownAction')
        .then(() => fixMarker(editor, line));
}

export function deactivate() { }
