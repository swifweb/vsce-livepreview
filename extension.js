// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const { readBuilderProgram } = require('typescript');
const vscode = require('vscode');
const fs = require('fs');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// Track currently webview panel
	let currentPanel = undefined;

	let disposable = vscode.commands.registerCommand('webber.livepreview', () => {
		const columnToShowIn = vscode.window.activeTextEditor
        	? vscode.window.activeTextEditor.viewColumn
        	: undefined;
		
		// if (currentPanel) {
		// 	// If we already have a panel, show it in the target column
		// 	currentPanel.reveal(vscode.ViewColumn.Two);
		// } else {
		// 	// Otherwise, create a new panel
		let currentPanel = vscode.window.createWebviewPanel(
			"webber", 
			"Webber Live Preview", 
			vscode.ViewColumn.Two,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.file(context.extensionPath + '/media')
				]
			}
		);
		currentPanel.visible = true;
		const filePath = vscode.Uri.file(context.extensionPath + '/media/index.html');
		currentPanel.webview.html = fs.readFileSync(filePath.fsPath, 'utf8').replaceAll('__LF__', currentPanel.webview.asWebviewUri(vscode.Uri.file(context.extensionPath + '/media')));
		currentPanel.iconPath = vscode.Uri.file(context.extensionPath + '/media/favicon.ico');

		// // Reset when the current panel is closed
		// currentPanel.onDidDispose(
		// 	() => {
		// 		currentPanel = undefined;
		// 	},
		// 	null,
		// 	context.subscriptions
		// );

		var builderProcess = null;

		function rebuild(doc, pwn) {
			console.log('rebuild called');
			if (builderProcess != null) {
				console.error('rebuild killed previous build');
				builderProcess.kill('SIGKILL');
			}

			let document = doc ?? vscode.window.activeTextEditor.document;
			console.log('pwn', pwn);
			let previewNames = pwn ?? [];
			console.log('previewNames', previewNames);
			console.log('rebuild looking for preview, lines: ' + document.lineCount);
			for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
				const line = document.lineAt(lineIndex);
				if (line.isEmptyOrWhitespace) continue;
				if (!line.text.includes('_Preview')) continue;
				let p1 = line.text.indexOf('class');
				let p2 = line.text.indexOf('_Preview');
				let p3 = line.text.indexOf('WebPreview');
				if (!(p1 < p2 && p2 < p3)) continue;
				previewNames.push(line.text.split('_Preview')[0].split('class ')[1]);
			}
			console.log('rebuild step 1', previewNames.length);
			if (previewNames.length == 0) {
				currentPanel.webview.postMessage({ type: 'previews.notfound' });
				return;
			}
			console.log('rebuild step 2');
			document.save();
			console.log('rebuild step 3');
			let filePath = document.fileName;
			if (!filePath.endsWith('.swift')) return;
			console.log('rebuild step 4');
			if (!filePath.includes('/Sources/')) return;
			console.log('rebuild step 5');
			let cwd = filePath.split('/Sources/')[0];
			let moduleName = filePath.split('/Sources/')[1].split('/')[0]
			let previews = previewNames.map(name => moduleName + '/' + name ).join(',')
			const command = `swift run -Xswiftc -DWEBPREVIEW ` + moduleName + ` --previews ` + previews + ` --build-path ./.build/.live`;
			console.log('rebuild command: ' + command);
			builderProcess = require('child_process')
				.spawn(
					'swift', 
					[
						'run',
						'--build-path', '.build/.live/',
						'-Xswiftc', '-DWEBPREVIEW',
						moduleName,
						'--previews', previews
					],
					{ cwd }
				);
			var errors = '';
			var resultJSON = '';
			currentPanel.webview.postMessage({ type: 'build.start' });
			console.log('rebuild step 6');
			builderProcess.stdout.on('data', function(msg) {
				resultJSON += msg.toString();
				console.log('out line: ' + msg.toString());
			});
			builderProcess.stderr.on('data', function(msg) {
				errors += msg.toString();
				console.log('err line: ' + msg.toString());
			});
			builderProcess.on('error', (error) => {
				currentPanel.webview.postMessage({ type: 'build.fail' });
				console.error(`error: ${error.message}`);
			});
			builderProcess.on('close', (code) => {
				console.log(`builderProcess exited with code ${code}`);
				if (code == 0) {
					let previewData = JSON.parse(resultJSON);
					console.dir(previewData);
					previewData.path = document.fileName;
					currentPanel.webview.postMessage({ type: 'build.success', data: previewData });
				} else if (code == 1 && errors.includes('unable to attach DB')) {
					console.warn('rebuild need restart');
					rebuild();
				} else {
					if (!code) return;
					currentPanel.webview.postMessage({ type: 'build.fail' });
					console.log('rebuild failed');
				}
			});
		}
		
		vscode.workspace.onDidChangeTextDocument(changeEvent => {
			if (changeEvent.document.uri != vscode.window.activeTextEditor.document.uri) return;
			rebuild();
		});

		var lastATE = null;
		vscode.window.onDidChangeActiveTextEditor(function (editor) {
			if (editor) lastATE = editor;
			if (builderProcess != null) {
				console.error('rebuild killed previous build');
				builderProcess.kill('SIGKILL');
			}
			let isSwift = editor.document.fileName.endsWith('.swift');
			currentPanel.webview.postMessage({
				type: 'document.switch',
				data: {
					path: editor.document.fileName,
					isSwift: isSwift
				}
			});
			if (isSwift) rebuild();
		});
		
		currentPanel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
				case 'addPreview':
					if (lastATE.document.fileName.endsWith('.swift')) {
						fs.appendFile(lastATE.document.fileName,
`
class MyNew_Preview: WebPreview {
	override class var title: String { "My preview" } // optional
	override class var width: UInt { 100 } // optional
	override class var height: UInt { 100 } // optional

	@Preview override class var content: Preview.Content {
		// add styles if needed
		// AppStyles.id(.happyStyle)
		// add here as many elements as needed
		Div("Hello world")
	}
}
`
						, function (err) {
							console.log('appendFile handler', err);
							if (err) throw err;
							console.log('appendFile handler2');
							console.log('will call rebuild');
							rebuild(lastATE.document, ['MyNew']);
						});
					}
					return;
				}
			},
			undefined,
			context.subscriptions
		);

		if (vscode.activeTextEditor != undefined) rebuild();
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
