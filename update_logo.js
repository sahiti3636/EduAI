const fs = require('fs');
const path = require('path');

const imgTag = '<img src="assets/logo.png" class="logo-img" alt="MindForge" />';

function replaceLogo(filePath) {
    if (!filePath.endsWith('.html')) return;
    let content = fs.readFileSync(filePath, 'utf8');
    let newContent = content.replace(/<div class="logo-icon">.*?<\/div>/g, imgTag);
    if (content !== newContent) {
        fs.writeFileSync(filePath, newContent, 'utf8');
        console.log(`Updated logo in: ${filePath}`);
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

// Inject CSS for .logo-img
const stylePath = 'frontend/css/style.css';
let styleContent = fs.readFileSync(stylePath, 'utf8');
if (!styleContent.includes('.logo-img')) {
    styleContent += '\n/* Logo Image */\n.logo-img { height: 32px; width: auto; border-radius: 8px; box-shadow: 0 0 15px rgba(124, 58, 237, 0.4); margin-right: 4px; }\n';
    fs.writeFileSync(stylePath, styleContent, 'utf8');
    console.log('Added .logo-img CSS to style.css');
}
