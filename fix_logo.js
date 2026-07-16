const fs = require('fs');
const path = require('path');

function replaceLogo(filePath) {
    if (!filePath.endsWith('.html')) return;
    let content = fs.readFileSync(filePath, 'utf8');
    let newContent = content.replace(
        /<img src="assets\/logo\.png" class="logo-img" alt="MindForge" \/>/g,
        '<img src="assets/logo.png" class="logo-img" alt="MindForge" style="height: 32px; width: auto; border-radius: 8px; margin-right: 6px;" />'
    );
    if (content !== newContent) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log(`Updated logo style in: ${filePath}`);
    }
}

function walkDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (!fullPath.includes('.git') && !fullPath.includes('node_modules')) {
                walkDir(fullPath);
            }
        } else {
            replaceLogo(fullPath);
        }
    }
}

walkDir('frontend');
