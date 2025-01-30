import { encoding_for_model  } from 'tiktoken';
import { execSync } from 'child_process';
import path from 'path';

// Configuration interface
interface Config {
  apiKey: string;
  model: string;
  maxTokens: number;
}

// Prints the message in a gray color
const debugLog = (message: string): void => {
  console.log(`\x1b[90m${message}\x1b[0m`);
};

const loadApiKey = async (): Promise<string> => {
  const apiKeyEnv = process.env.OPENAI_API_KEY;
  if (apiKeyEnv) {
    debugLog('Using OPENAI_API_KEY environment variable');
    return apiKeyEnv;
  }

  const apiKeyPath = path.join(process.env.HOME || '~', '.auto-commit-openai-api-key');
  const apiKeyFile = Bun.file(apiKeyPath);
  if (!(await apiKeyFile.exists())) {
    throw new Error('No OpenAI API key found. Please create a file at ~/.auto-commit-openai-api-key with your OpenAI API key or set the OPENAI_API_KEY environment variable.');
  }

  const apiKey = (await apiKeyFile.text()).trim();
  debugLog('Using OpenAI API key from ~/.auto-commit-openai-api-key');
  return apiKey;
}

// Validate and load environment variables
const loadConfig = async (): Promise<Config> => {
  const apiKey = await loadApiKey();

  return {
    apiKey,
    model: 'gpt-4o-mini',
    maxTokens: 200,
  };
};

const isGitRepo = (): boolean => {
  try {
    execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
};

// Get git diff output
const getGitDiff = (): string => {
  try {
    return execSync('git diff --cached', { encoding: 'utf-8' });
  } catch (error) {
    throw new Error('Failed to get git diff: ' + (error as Error).message);
  }
};

// Generate commit message using OpenAI API
const generateCommitMessage = async (diff: string, config: Config): Promise<string> => {

  const messages = [
    {
      role: 'system',
      content: 'Generate a concise git commit message in conventional commit format based on the provided diff. Focus on the main changes and their impact.'
    },
    {
      role: 'user',
      content: `Here is the git diff:\n\n${diff}`
    }
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: messages,
      temperature: 0.7,
      max_tokens: config.maxTokens
    })
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content.trim();
};

const calcCost = (diff: string): number => {
  const encoder = encoding_for_model('gpt-4o-mini');
  const tokens = encoder.encode(diff);

  // $0.000150 / 1K input tokens
  return (tokens.length / 1000) * 0.000150;
};

// Main function
const main = async () => {
  try {
    if (!isGitRepo()) {
      console.error('Not in a git repository.');
      return;
    }

    const config = await loadConfig();
    const diff = getGitDiff();

    debugLog(`Got git diff with length: ${diff.length}`);
    const cost = calcCost(diff);
    debugLog(`Estimated cost: $${cost.toFixed(6)}`);

    if (cost > 0.01) {
      console.log('Git diff will cost you $0.01 or more, are you sure you want to continue? (y/n)');
      const userInput = prompt('Do you want to continue? (y/n)');
      if (userInput?.toLowerCase() !== 'y') {
        console.log('Aborting.');
        return;
      }
    }

    if (!diff.trim()) {
      console.log('No changes to commit. Did you forget to `git add`?');
      return;
    }

    const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const spinnerInterval = setInterval(() => {
      process.stdout.write(`\r${spinner[i]} Generating commit message...`);
      i = (i + 1) % spinner.length;
    }, 80);

    const commitMessage = await generateCommitMessage(diff, config);
    
    clearInterval(spinnerInterval);
    process.stdout.write('\r'); // Clear spinner line
    console.log(commitMessage);
    

    console.log('\n');
    // Ask the user if they want to commit with this message
    prompt("Press Enter to commit with this message, or Ctrl+C to cancel.");

    execSync(`git commit -m "${commitMessage}"`);
    debugLog('Committed with message:');
    console.log(commitMessage);
  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
};

// Run the program
main();
