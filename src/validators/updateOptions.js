import fs from 'fs';
import path from 'path';

const dir = './';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'updateOptions.js' && f !== 'companyValidator.js');

for (const file of files) {
  const filePath = path.join(dir, file);
  let content = fs.readFileSync(filePath, 'utf-8');
  
  let modified = false;
  
  // Find Joi.object({ ... }) and append .options({ stripUnknown: true, abortEarly: false }) if not present.
  // Using a simpler approach: replace the closing brace of Joi.object if it's the last thing.
  
  // Match `body: Joi.object({...})`
  // This regex matches `Joi.object({` up to the matching `})` using greedy until a comma or newline.
  const regexes = [
    /body:\s*Joi\.object\(\{[\s\S]*?\}\)(?!\.options)/g,
    /query:\s*Joi\.object\(\{[\s\S]*?\}\)(?!\.options)/g,
    /params:\s*Joi\.object\(\{[\s\S]*?\}\)(?!\.options)/g
  ];

  for (const regex of regexes) {
      content = content.replace(regex, (match) => {
          modified = true;
          return match + '.options({ stripUnknown: true, abortEarly: false })';
      });
  }

  if (modified) {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`Updated ${file}`);
  }
}
