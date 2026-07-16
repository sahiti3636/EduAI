const fs = require('fs');
let css = fs.readFileSync('frontend/css/style.css', 'utf8');

css = css.replace(/color:\s*#ffffff;?/gi, 'color: var(--text-hi);');
css = css.replace(/color:\s*#fff;?/gi, 'color: var(--text-hi);');
css = css.replace(/color:\s*white;?/gi, 'color: var(--text-hi);');

// Replace rgba text colors dynamically
css = css.replace(/color:\s*rgba\(255,\s*255,\s*255,\s*([0-9.]+)\);?/gi, (match, opacityStr) => {
    const opacity = parseFloat(opacityStr);
    if (opacity > 0.75) return 'color: var(--text-hi);';
    if (opacity > 0.4) return 'color: var(--text-mid);';
    return 'color: var(--text-lo);';
});

// Special cases
css = css.replace(
    /\.nav-link:hover\s*\{\s*color:\s*var\(--text-hi\);\s*background:\s*rgba\(255,\s*255,\s*255,\s*0\.08\);\s*\}/g,
    '.nav-link:hover { color: var(--text-hi); background: var(--surface-hi); }'
);
css = css.replace(
    /\.bucket-B\s*\{\s*background:\s*rgba\(255,255,255,0\.09\);\s*color:\s*var\(--text-hi\);\s*border:\s*1px solid rgba\(255,255,255,0\.22\);\s*\}/g,
    '.bucket-B { background: var(--surface-hi); color: var(--text-hi); border: 1px solid var(--border); }'
);
css = css.replace(
    /\.legend-dot\.not_tested\s*\{\s*background:\s*rgba\(255,255,255,0\.05\);\s*border-color:\s*rgba\(255,255,255,0\.2\);\s*\}/g,
    '.legend-dot.not_tested { background: var(--surface-hi); border-color: var(--border); }'
);

fs.writeFileSync('frontend/css/style.css', css);
console.log('done style.css');
