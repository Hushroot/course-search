'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const root=path.resolve(__dirname,'..');
const envPath=path.join(root,'.env');
if(fs.existsSync(envPath)&&!process.argv.includes('--force')){
  console.error('.env already exists. Delete it first or run: node scripts/setup.js --force');
  process.exit(1);
}
const admin=`Admin-${crypto.randomBytes(14).toString('base64url')}`;
const secret=crypto.randomBytes(48).toString('base64url');
const text=`PORT=3000\nADMIN_PASSWORD=${admin}\nSESSION_SECRET=${secret}\nCOOKIE_SECURE=false\n`;
fs.writeFileSync(envPath,text,{mode:0o600});
console.log('Created .env');
console.log(`Admin password: ${admin}`);
console.log('Save that password somewhere private.');
