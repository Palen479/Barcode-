console.log('Bot starting...');

const TelegramBot = require('node-telegram-bot-api');
const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { createCanvas, registerFont } = require('canvas');
const AdmZip = require('adm-zip');

// Ganti 'YOUR_BOT_TOKEN' dengan token bot Telegram Anda
const token = '7387284527:AAGziIU_Hpq8U3Ps-ht4x8WSDTxgjQdw3UY';

// Buat instance bot
const bot = new TelegramBot(token, {polling: true});

console.log('Bot instance created');

const logos = {
  alfamart: path.join(__dirname, 'alfamart_logo.png'),
  indomaret: path.join(__dirname, 'indomaret_logo.png')
};

const freeText = {
  '400gram': 'Gratis Chilkid 400gram',
  '190gram': 'Gratis Chilkid 190gram'
};

let userState = {};

// Tangani perintah /start dan /help
bot.onText(/\/start|\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Selamat datang! Gunakan /createbarcode untuk membuat barcode.');
});

// Tangani perintah /createbarcode
bot.onText(/\/createbarcode/, (msg) => {
  const chatId = msg.chat.id;
  userState[chatId] = { step: 'chooseLogo' };
  bot.sendMessage(chatId, 'Pilih logo:', {
    reply_markup: {
      inline_keyboard: [
        [
          { text: 'Alfamart', callback_data: 'logo_alfamart' },
          { text: 'Indomaret', callback_data: 'logo_indomaret' }
        ]
      ]
    }
  });
});

// Tangani callback query
bot.on('callback_query', async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const data = callbackQuery.data;

  if (data.startsWith('logo_')) {
    userState[chatId].logo = data.split('_')[1];
    userState[chatId].step = 'inputFreeText';
    
    bot.answerCallbackQuery(callbackQuery.id);
    bot.sendMessage(chatId, 'Masukkan teks gratis yang ingin Anda tampilkan (contoh: Gratis Chilkid 400gram):');
  }
});

// Tangani semua pesan teks
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!userState[chatId]) {
    return;
  }

  switch (userState[chatId].step) {
    case 'inputFreeText':
      userState[chatId].freeText = text;
      console.log('Saved free text:', userState[chatId].freeText);  // Add this log
      userState[chatId].step = 'inputCodes';
      userState[chatId].codes = [];
      bot.sendMessage(chatId, 'Teks gratis telah disimpan. Sekarang masukkan kode-kode untuk barcode. Anda dapat memasukkan beberapa kode sekaligus dengan memisahkannya menggunakan koma (,). Ketik /selesai jika sudah selesai.');
      break;

    case 'inputCodes':
      if (text === '/selesai') {
        if (userState[chatId].codes.length > 0) {
          bot.sendMessage(chatId, 'Membuat dan mengirim barcode...');
          const zip = new AdmZip();
          for (let i = 0; i < userState[chatId].codes.length; i++) {
            const code = userState[chatId].codes[i];
            try {
              const barcodeImage = await createBarcodeWithLogo(code, userState[chatId].logo, userState[chatId].freeText);
              
              // Kirim barcode individual
              await bot.sendPhoto(chatId, barcodeImage, {caption: `Barcode untuk: ${code}`});
              
              // Tambahkan ke ZIP
              zip.addFile(`barcode_${i+1}.png`, barcodeImage);
            } catch (error) {
              console.error('Error creating barcode:', error);
              bot.sendMessage(chatId, `Gagal membuat barcode untuk kode: ${code}`);
            }
          }
          
          // Kirim file ZIP
          const zipBuffer = zip.toBuffer();
          await bot.sendDocument(chatId, zipBuffer, {
            filename: 'barcodes.zip',
            caption: 'Semua barcode dalam format ZIP'
          });
          
          bot.sendMessage(chatId, 'Semua barcode telah dikirim dan juga disertakan dalam file ZIP.');
          delete userState[chatId];
        } else {
          bot.sendMessage(chatId, 'Tidak ada kode yang dimasukkan. Proses dibatalkan.');
          delete userState[chatId];
        }
      } else {
        const newCodes = text.split(',').map(code => code.trim()).filter(code => code !== '');
        userState[chatId].codes.push(...newCodes);
        bot.sendMessage(chatId, `${newCodes.length} kode ditambahkan. Total: ${userState[chatId].codes.length} kode. Masukkan kode lain atau ketik /selesai jika sudah selesai.`);
      }
      break;
  }
});

// Fungsi untuk membuat barcode dengan logo
async function createBarcodeWithLogo(text, logoName, freeText) {
  console.log('Creating barcode with text:', text, 'logo:', logoName, 'free text:', freeText);

  // Buat barcode
  const barcode = await bwipjs.toBuffer({
    bcid: 'code128',
    text: text,
    scale: 5,
    height: 10,
    includetext: true,
    textxalign: 'center',
    paddingwidth: 10,
    paddingheight: 5,
    backgroundcolor: 'FFFFFF',
  });

  // Baca dan perbesar logo
  const logo = await sharp(logos[logoName])
    .resize(600, null, { fit: 'inside' })
    .toBuffer();

  const logoMetadata = await sharp(logo).metadata();

  // Resize barcode
  const resizedBarcode = await sharp(barcode)
    .resize({
      width: Math.floor(logoMetadata.width * 0.85),
      height: Math.floor(logoMetadata.height * 0.4),
      fit: 'inside'
    })
    .toBuffer();

  const resizedBarcodeMetadata = await sharp(resizedBarcode).metadata();

  // Hitung posisi barcode
  const horizontalOffset = Math.floor(logoMetadata.width * -0.1);
  const barcodeLeft = Math.floor((logoMetadata.width - resizedBarcodeMetadata.width) / 2) + horizontalOffset;
  const barcodeTop = Math.floor((logoMetadata.height - resizedBarcodeMetadata.height) / 2);

  // Buat teks gratis
  const canvas = createCanvas(logoMetadata.width, logoMetadata.height);
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 24px Arial';  // Anda bisa menyesuaikan ukuran font di sini
  ctx.fillStyle = 'white';  // Warna teks putih
  ctx.textAlign = 'center';
  
  // Hitung posisi teks
  const textX = logoMetadata.width / 2 + horizontalOffset;
  const textY = Math.min(barcodeTop + resizedBarcodeMetadata.height + 40, logoMetadata.height - 20);
  
  ctx.fillText(freeText, textX, textY);  // Gambar teks putih
  const textBuffer = canvas.toBuffer('image/png');

  // Gabungkan logo, barcode, dan teks
  const result = await sharp(logo)
    .composite([
      { 
        input: resizedBarcode,
        top: barcodeTop,
        left: barcodeLeft
      },
      {
        input: textBuffer,
        top: 0,
        left: 0
      }
    ])
    .png()
    .toBuffer();

  return result;
}

console.log('Bot is running...');

process.on('unhandledRejection', (reason, promise) => {
  console.log('Unhandled Rejection at:', promise, 'reason:', reason);
});
