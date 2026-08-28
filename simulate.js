const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const CHAT_ID = 142499768;

console.log("🟢 Ultron Local Simulator Started!");
console.log("Internet tunnels are blocked, so use this terminal to send messages to your local webhook.");
console.log("Ultron will process them and reply directly to your actual Telegram app on your phone!");
console.log("Type 'exit' to quit.\n");

function ask() {
  rl.question('You (Farzin): ', async (text) => {
    if (text.toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    try {
      await fetch('http://localhost:3000/api/telegram/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            chat: { id: CHAT_ID },
            text: text
          }
        })
      });
      console.log("  [Payload sent. Check your phone for Ultron's reply!]\n");
    } catch (e) {
      console.error("  [Error hitting webhook. Ensure 'npm run dev' is running]", e.message);
    }
    
    ask();
  });
}

ask();
