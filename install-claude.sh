#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
case "${1:-}" in ''|--check|--no-statusline) ;; *) echo 'Usage: sh install-claude.sh [--check|--no-statusline]' >&2; exit 2;; esac
command -v claude >/dev/null 2>&1 || { echo 'Claude Code CLI is required. Install it first; this script will not download or authenticate it.' >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo 'Node.js 22.12+ is required.' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)' || { echo 'Node.js 22.12+ is required.' >&2; exit 1; }
marketplace="$repo/dist/claude-marketplace"
if [ -f "$repo/.claude-plugin/marketplace.json" ]; then marketplace="$repo"; fi
[ -f "$marketplace/plugins/goal-progress/bin/goal-progress.cjs" ] || { echo 'Build the Claude distribution first: pnpm build:claude' >&2; exit 1; }
config_root=${CLAUDE_CONFIG_DIR:-$HOME/.claude}
node - "$config_root/settings.json" "${1:-}" <<'NODE'
const fs = require('node:fs');
const file = process.argv[2];
if (fs.existsSync(file)) {
 const data = JSON.parse(fs.readFileSync(file, 'utf8'));
 if (process.argv[3] !== '--no-statusline' && data.statusLine && (data.statusLine.type !== 'command' || typeof data.statusLine.command !== 'string')) {
  console.error('Unsupported existing statusLine; preserve it and configure Goal Progress manually.'); process.exit(1);
 }
}
NODE
if [ "${1:-}" = --check ]; then echo 'Prerequisites and distribution ready. No settings changed.'; exit 0; fi
node - "$config_root" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2]);
const file = path.join(root, 'settings.json');
fs.mkdirSync(root, {recursive:true,mode:0o700});
const existed = fs.existsSync(file);
const backup = file + '.goal-progress-' + Date.now() + '-' + process.pid;
if (existed) fs.copyFileSync(file, backup + '.bak', fs.constants.COPYFILE_EXCL);
fs.writeFileSync(backup + '.state.json', JSON.stringify({existed, settingsFile:file, backup:existed ? backup + '.bak' : null},null,2)+'\n', {mode:0o600,flag:'wx'});
console.log('Pre-install settings state: '+backup+'.state.json');
NODE
claude plugin marketplace add "$marketplace"
claude plugin install goal-progress@goal-progress-local --scope user
if [ "${1:-}" != --no-statusline ]; then
node - "$config_root" "$marketplace/plugins/goal-progress/bin/goal-progress.cjs" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(process.argv[2]);
const dir = path.join(root, 'goal-progress-statusline');
const settingsFile = path.join(root, 'settings.json');
const existed = fs.existsSync(settingsFile);
const raw = existed ? fs.readFileSync(settingsFile, 'utf8') : '{}';
const settings = JSON.parse(raw);
fs.mkdirSync(dir, {recursive:true, mode:0o700});
const wrapper = path.join(dir, 'statusline.cjs');
const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
const command = quote(process.execPath) + ' ' + quote(wrapper);
const metadataFile = path.join(dir, 'config.json');
const old = settings.statusLine?.command === command && fs.existsSync(metadataFile) ? JSON.parse(fs.readFileSync(metadataFile,'utf8')).previous : settings.statusLine ?? null;
const metadata = {previous:old, node:process.execPath, bundle:path.resolve(process.argv[3]), dataRoot:path.join(root,'plugins/data/goal-progress-goal-progress-local')};
fs.writeFileSync(metadataFile,JSON.stringify(metadata,null,2),{mode:0o600});
fs.writeFileSync(wrapper,`const fs=require('node:fs');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const c=JSON.parse(fs.readFileSync(path.join(__dirname,'config.json'),'utf8'));
const input=fs.readFileSync(0,'utf8');
let previous='';
if(c.previous?.type==='command') {const r=spawnSync(c.previous.command,{shell:true,input,encoding:'utf8',timeout:3000,maxBuffer:1048576}); previous=r.stdout?.trimEnd()??'';}
const r=spawnSync(c.node,[c.bundle,'statusline'],{input,encoding:'utf8',timeout:3000,maxBuffer:1048576,env:{...process.env,GOAL_PROGRESS_CLAUDE_DATA:c.dataRoot}});
const progress=r.stdout?.trimEnd()??'';
process.stdout.write([previous,progress].filter(Boolean).join('\\n'));
`,{mode:0o600});
settings.statusLine={...(settings.statusLine??{}),type:'command',command};
const temporary=settingsFile+'.goal-progress-'+process.pid+'.tmp';
fs.writeFileSync(temporary,JSON.stringify(settings,null,2)+'\n',{mode:0o600,flag:'wx'});
fs.renameSync(temporary,settingsFile);
NODE
fi
echo 'Installed. In Claude Code run /reload-plugins, then /goal-progress:track followed by your task. No application was restarted.'
