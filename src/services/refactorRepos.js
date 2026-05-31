import fs from 'fs';
import path from 'path';

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

walkDir('../controllers', (filePath) => {
  if (!filePath.endsWith('.js') || filePath.includes('refactorRepos.js') || filePath.includes('baseController.js')) return;

  let content = fs.readFileSync(filePath, 'utf-8');
  let original = content;

  // Add repo imports if not present
  if (!content.includes('../repositories/index.js') && !content.includes('../../repositories/index.js')) {
    const importPath = filePath.includes('\\agent\\') || filePath.includes('\\channels\\') || filePath.includes('\\chat\\') 
      ? '../../repositories/index.js' 
      : '../repositories/index.js';
      
    content = `import { companyRepo, userRepo, ticketRepo, chatSessionRepo, eventLogRepo, callRepo, qaAnalysisRepo } from '${importPath}';\n` + content;
    // Remove old model imports to avoid unused vars
    // Wait, let's keep them if they are used for constants or types, but we'll try to replace them.
  }

  // Replace standard calls
  const replacements = [
    { regex: /\bUser\.findOne\(/g, rep: 'userRepo.findOne(' },
    { regex: /\bUser\.findById\(/g, rep: 'userRepo.model.findById(' },
    { regex: /\bUser\.find\(/g, rep: 'userRepo.model.find(' },
    { regex: /\bUser\.create\(/g, rep: 'userRepo.create(' },
    { regex: /\bUser\.countDocuments\(/g, rep: 'userRepo.count(' },
    
    { regex: /\bCompany\.findOne\(/g, rep: 'companyRepo.findOne(' },
    { regex: /\bCompany\.findById\(/g, rep: 'companyRepo.model.findById(' },
    { regex: /\bCompany\.find\(/g, rep: 'companyRepo.model.find(' },
    
    { regex: /\bTicket\.findOne\(/g, rep: 'ticketRepo.findOne(' },
    { regex: /\bTicket\.findById\(/g, rep: 'ticketRepo.model.findById(' },
    { regex: /\bTicket\.find\(/g, rep: 'ticketRepo.model.find(' },
    { regex: /\bTicket\.create\(/g, rep: 'ticketRepo.create(' },
    { regex: /\bTicket\.countDocuments\(/g, rep: 'ticketRepo.count(' },
    { regex: /\bTicket\.updateMany\(/g, rep: 'ticketRepo.updateMany(' },
    { regex: /\bTicket\.aggregate\(/g, rep: 'ticketRepo.aggregate(' },
    
    { regex: /\bChatSession\.findOne\(/g, rep: 'chatSessionRepo.findOne(' },
    { regex: /\bChatSession\.find\(/g, rep: 'chatSessionRepo.model.find(' },
    
    { regex: /\bCall\.find\(/g, rep: 'callRepo.model.find(' },
    { regex: /\bCall\.countDocuments\(/g, rep: 'callRepo.count(' },
    
    { regex: /\bQAAnalysis\.findOneAndUpdate\(/g, rep: 'qaAnalysisRepo.model.findOneAndUpdate(' },
  ];

  replacements.forEach(({regex, rep}) => {
    content = content.replace(regex, rep);
  });

  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Refactored ${filePath}`);
  }
});
