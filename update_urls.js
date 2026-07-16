const fs = require('fs');

// Update vercel.json
let vercel = fs.readFileSync('vercel.json', 'utf8');
vercel = vercel.replace(/https:\/\/eduai-backend-4ad2\.onrender\.com/g, 'https://mindforge-backend-37xk.onrender.com');
vercel = vercel.replace(/https:\/\/YOUR_RENDER_URL\.onrender\.com/g, 'https://mindforge-backend-37xk.onrender.com');
fs.writeFileSync('vercel.json', vercel, 'utf8');

// Update env.js
let env = fs.readFileSync('frontend/js/env.js', 'utf8');
env = env.replace(/window\.MINDFORGE_API_BASE\s*=\s*".*?"/g, 'window.MINDFORGE_API_BASE = "https://mindforge-backend-37xk.onrender.com"');
fs.writeFileSync('frontend/js/env.js', env, 'utf8');
console.log('URLs updated successfully.');
