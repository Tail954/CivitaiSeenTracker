const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const file = path.join(root, 'civitai-seen-tracker.user.js');
const moduleSource = fs.readFileSync(path.join(root, 'src/date-filter.js'), 'utf8').replace(/\r\n/g, '\n');
const moduleBody = moduleSource.split('// CommonJS export is excluded')[0].trimEnd();
const current = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const pattern = /    \/\/ BEGIN GENERATED DATE FILTER MODULE[\s\S]*?    \/\/ END GENERATED DATE FILTER MODULE/;
if (!pattern.test(current)) throw new Error('Date filter build markers are missing');
const block = '    // BEGIN GENERATED DATE FILTER MODULE\n'
    + moduleBody.split('\n').map(line => line ? '    ' + line : '').join('\n')
    + '\n    // END GENERATED DATE FILTER MODULE';
const generated = current.replace(pattern, () => block);
if (process.argv.includes('--check')) {
    if (generated !== current) throw new Error('Userscript bundle is stale; run node scripts/build-userscript.cjs');
} else fs.writeFileSync(file, generated);
