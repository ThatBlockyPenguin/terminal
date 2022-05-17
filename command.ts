const args = input.value.split(' ');
  const command = args.shift();
  let result;
  
  if(Object.keys(commandRegistry).includes(command))
    result = commandRegistry[command][0](args)
  else result = `Unknown command! Type 'help' for for help.`;