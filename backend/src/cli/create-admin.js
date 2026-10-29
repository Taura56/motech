import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { createInitialAdministrator } from '../services/adminManagementService.js';

const terminal = readline.createInterface({ input: stdin, output: stdout });
function readHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
    throw new Error('Run this command in a private interactive terminal so the password is not echoed.');
  }
  return new Promise((resolve, reject) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';
    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (buffer) => {
      for (const character of buffer.toString()) {
        if (character === '\u0003') {
          cleanup();
          reject(new Error('Password entry cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          cleanup();
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (character === '\u0008' || character === '\u007f') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stdin.on('data', onData);
  });
}
try {
  const fullName = (await terminal.question('Administrator full name: ')).trim();
  const email = (await terminal.question('Administrator email: ')).trim().toLowerCase();
  terminal.close();
  const password = await readHidden('Administrator password (hidden input): ');
  if (fullName.length < 2 || fullName.length > 80) throw new Error('Full name must be 2-80 characters.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 14 || password.length > 200) throw new Error('Password must be 14-200 characters.');
  await mongoose.connect(config.MONGODB_URI);
  const admin = await createInitialAdministrator({ fullName, email, password });
  console.log(`Created initial administrator ${admin.email}`);
} finally {
  terminal.close();
  if (mongoose.connection.readyState) await mongoose.disconnect();
}
