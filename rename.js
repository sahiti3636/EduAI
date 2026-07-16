const fs = require('fs');
const path = require('path');

function replaceInFile(filePath) {
    if (filePath.includes('.git') || filePath.includes('.db') || filePath.includes('__pycache__') || filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.svg') || filePath.endsWith('.woff') || filePath.endsWith('.ttf') || filePath.endsWith('.woff2')) return;
    try {
        let content = fs.readFileSync(filePath, 'utf8');
        let newContent = content
            .replace(/MindForge/g, 'MindForge')
            .replace(/mindforge/g, 'mindforge')
            .replace(/MINDFORGE/g, 'MINDFORGE');
        if (content !== newContent) {
            fs.writeFileSync(filePath, newContent, 'utf8');
            console.log(`Updated: ${filePath}`);
        }
    } catch (e) {
        // likely a binary file or directory, skip
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!fullPath.includes('.git') && !fullPath.includes('__pycache__')) {
                walkDir(fullPath);
            }
        } else {
            replaceInFile(fullPath);
        }
    }
}

walkDir('.');
console.log('Renaming complete.');
