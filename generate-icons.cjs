const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const sizes = [192, 512];
const publicDir = path.join(__dirname, 'public');

async function generateIcons() {
  for (const size of sizes) {
    const svgPath = path.join(publicDir, `pwa-${size}x${size}.svg`);
    const pngPath = path.join(publicDir, `pwa-${size}x${size}.png`);
    
    const svgBuffer = fs.readFileSync(svgPath);
    
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(pngPath);
    
    console.log(`Generated: pwa-${size}x${size}.png`);
  }
  console.log('Done!');
}

generateIcons().catch(console.error);
