const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const outputDir = path.join(__dirname, '..', '.vercel', 'output', 'static');
const apiBase = process.env.API_BASE_URL || '';

fs.mkdirSync(outputDir, { recursive: true });

function processHtml(file) {
  let content = fs.readFileSync(file, 'utf-8');
  
  const scriptTag = `<script id="config" type="application/json">
      {"apiBase": "API_BASE_PLACEHOLDER"}
    </script>`;
  const apiBaseValue = apiBase || '';
  const replacement = `<script id="config" type="application/json">
      {"apiBase": "${apiBaseValue}"}
    </script>`;
  
  content = content.replace(scriptTag, replacement);
  
  const outFile = path.join(outputDir, path.basename(file));
  fs.writeFileSync(outFile, content);
}

const files = fs.readdirSync(publicDir).filter(f => !f.startsWith('.'));
for (const file of files) {
  const src = path.join(publicDir, file);
  const stat = fs.statSync(src);
  
  if (stat.isDirectory()) {
    const subDir = path.join(outputDir, file);
    fs.mkdirSync(subDir, { recursive: true });
    const subFiles = fs.readdirSync(src);
    for (const subFile of subFiles) {
      const subSrc = path.join(src, subFile);
      const subOut = path.join(subDir, subFile);
      fs.copyFileSync(subSrc, subOut);
    }
  } else if (path.extname(file) === '.html') {
    processHtml(src);
  } else {
    const out = path.join(outputDir, file);
    fs.copyFileSync(src, out);
  }
}

console.log('Built frontend for Vercel');
