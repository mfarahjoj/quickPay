const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Input logo path
const inputLogo = '/Users/mahamedfarah/Downloads/touchpay.png';

// iOS Icon Sizes
const iosSizes = [
  { size: 20, scale: 2, name: 'Icon-20@2x.png' },
  { size: 20, scale: 3, name: 'Icon-20@3x.png' },
  { size: 29, scale: 2, name: 'Icon-29@2x.png' },
  { size: 29, scale: 3, name: 'Icon-29@3x.png' },
  { size: 40, scale: 2, name: 'Icon-40@2x.png' },
  { size: 40, scale: 3, name: 'Icon-40@3x.png' },
  { size: 60, scale: 2, name: 'Icon-60@2x.png' },
  { size: 60, scale: 3, name: 'Icon-60@3x.png' },
  { size: 1024, scale: 1, name: 'Icon-1024.png' },
];

// Android Icon Sizes
const androidSizes = [
  { folder: 'mipmap-mdpi', size: 48 },
  { folder: 'mipmap-hdpi', size: 72 },
  { folder: 'mipmap-xhdpi', size: 96 },
  { folder: 'mipmap-xxhdpi', size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
];

async function generateIcons() {
  console.log('🎨 Generating all app icons from touchpay.png...\n');
  
  // Check if input file exists
  if (!fs.existsSync(inputLogo)) {
    console.error('❌ Error: Logo file not found at', inputLogo);
    console.log('   Please make sure touchpay.png is in Downloads folder');
    process.exit(1);
  }

  // Create directories
  const iosDir = path.join(__dirname, '../mobile/ios/QuickPay/Images.xcassets/AppIcon.appiconset');
  const androidDir = path.join(__dirname, '../mobile/android/app/src/main/res');
  
  fs.mkdirSync(iosDir, { recursive: true });

  // Generate iOS icons
  console.log('📱 iOS Icons:');
  for (const icon of iosSizes) {
    const size = Math.round(icon.size * icon.scale);
    const output = path.join(iosDir, icon.name);
    
    await sharp(inputLogo)
      .resize(size, size)
      .png()
      .toFile(output);
    
    console.log(`  ✓ ${icon.name} (${size}x${size})`);
  }

  // Generate Android icons
  console.log('\n🤖 Android Icons:');
  for (const icon of androidSizes) {
    const folder = path.join(androidDir, icon.folder);
    fs.mkdirSync(folder, { recursive: true });
    
    const output = path.join(folder, 'ic_launcher.png');
    await sharp(inputLogo)
      .resize(icon.size, icon.size)
      .png()
      .toFile(output);
    
    console.log(`  ✓ ${icon.folder}/ic_launcher.png (${icon.size}x${icon.size})`);
  }

  // Play Store icon
  const playStore = path.join(androidDir, 'play-store-icon.png');
  await sharp(inputLogo).resize(512, 512).png().toFile(playStore);
  console.log('  ✓ play-store-icon.png (512x512)');

  console.log('\n✅ All icons generated successfully!');
  console.log('\n📋 Generated:');
  console.log(`   - ${iosSizes.length} iOS sizes`);
  console.log(`   - ${androidSizes.length} Android densities`);
  console.log(`   - 1 Play Store icon (512x512)`);
  console.log(`   - 1 App Store icon (1024x1024)`);
}

generateIcons().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
