import anthropic from './anthropic.js';
import dashscope from './dashscope.js';
import gemini from './gemini.js';
import openrouter from './openrouter.js';
import kling from './kling.js';
import suno from './suno.js';

const ADAPTERS = [anthropic, dashscope, gemini, openrouter, kling, suno];

export function registerAll(registerProvider) {
  ADAPTERS.forEach(registerProvider);
}
