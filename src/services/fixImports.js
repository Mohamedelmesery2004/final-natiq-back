import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

function fixImports(dirPath, isNested) {
  walkDir(dirPath, (filePath) => {
    if (!filePath.endsWith('.js')) return;
    let content = fs.readFileSync(filePath, 'utf-8');
    
    // Check if it's nested (e.g. src/services/chat/file.js)
    // The relative path is like '../controllers/adminChatController.js'
    const nested = filePath.includes('\\agent\\') || filePath.includes('/agent/') || 
                   filePath.includes('\\channels\\') || filePath.includes('/channels/') || 
                   filePath.includes('\\chat\\') || filePath.includes('/chat/');
                   
    if (nested) {
      content = content.replace(/from '\.\.\/repositories\/index\.js';/g, "from '../../repositories/index.js';");
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
  });
}

fixImports('../services', false);
fixImports('../controllers', false);
