import { execSync } from 'child_process';
import path from 'path';

// Configuration interface
interface Config {
  apiKey: string;
  model: string;
  maxTokens: number;
}

const loadApiKey = async (): Promise<string> => {
  const apiKeyEnv = process.env.OPENAI_API_KEY;
  if (apiKeyEnv) {
    console.log('Using OPENAI_API_KEY environment variable');
    return apiKeyEnv;
  }

  const apiKeyPath = path.join(process.env.HOME || '~', '.auto-commit-openai-api-key');
  const apiKeyFile = Bun.file(apiKeyPath);
  if (!(await apiKeyFile.exists())) {
    throw new Error('No OpenAI API key found. Please create a file at ~/.auto-commit-openai-api-key with your OpenAI API key or set the OPENAI_API_KEY environment variable.');
  }

  const apiKey = (await apiKeyFile.text()).trim();
  console.log('Using OpenAI API key from ~/.auto-commit-openai-api-key');
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

// Copy to clipboard (cross-platform)
const copyToClipboard = (text: string): void => {
  try {
    const platform = process.platform;
    const command = platform === 'linux'
      ? 'xclip -selection clipboard'
      : platform === 'darwin'
        ? 'pbcopy'
        : 'clip';

    execSync(`echo "${text}" | ${command}`, { stdio: 'pipe' });
  } catch (error) {
    console.warn('Failed to copy to clipboard:', (error as Error).message);
  }
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

    if (!diff.trim()) {
      console.log('No changes to commit. Exiting.');
      return;
    }

    console.log('Generating commit message...');
    const commitMessage = await generateCommitMessage(diff, config);

    console.log(commitMessage);
    // Ask the user if they want to commit with this message
    const userInput = prompt('Do you want to commit with this message? (y/n)');
    if (userInput?.toLowerCase() === 'y') {
      execSync(`git commit -m "${commitMessage}"`);
    }

    // copyToClipboard(commitMessage);
    // console.log('\nCommit message copied to clipboard:\n');
    // console.log(commitMessage);

  } catch (error) {
    console.error('Error:', (error as Error).message);
    process.exit(1);
  }
};

// Run the program
main();
