import { SonoClient } from 'https://deno.land/x/sono@v1.1/src/sonoClient.js';

const input = document.getElementById('input');
const term = document.getElementById('term');

const sono = new SonoClient('wss://terminal---pixelorangedev.repl.co/ws');

sono.onconnection(()=>{
  sono.message('client connected')
})

sono.on('message', (msg) => {
  console.log('message received:', msg)
})

input.addEventListener('keyup', (e) => {
  if(e.key == 'Enter')
    runCommand();
});

async function runCommand() {
  output(input.value);
  
  result = '-';

  if(result !== undefined)
    output(result);
  
  input.value = '';
}

function output(value) {
  if(term.innerText !== '')
    result = term.innerText += '\n';
  
  term.innerText += value;
}

const commandRegistry = {
  help: [
    (args) => {
      let msg = '';
      
      for(const cmd in commandRegistry)
        msg += `\n${cmd}: ${commandRegistry[cmd][1]}`

      msg = msg.substring(1);
      
      return msg;
    },
    'Shows this help message'
  ],
  
  github: [
    (args) => {
      window.open(`https://github.com/${args[0] === undefined ? 'ThatBlockyPenguin' : args[0]}`, '_blank');
      return 'Opening GitHub...';
    },
    `Opens my GitHub page in a new tab. If an argument is specified, the page at that route will be opened instead. e.g. 'github octocat'`
  ],

  gui: [
    (args) => {
      
    }
  ]
};