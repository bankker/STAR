import anthropic from './anthropic.js';
import dashscope from './dashscope.js';
import gemini from './gemini.js';
import openrouter from './openrouter.js';
import kling from './kling.js';

const ADAPTERS = [anthropic, dashscope, gemini, openrouter, kling];

export function registerAll(registerProvider) {
  ADAPTERS.forEach(registerProvider);
}
