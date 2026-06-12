import anthropic from './anthropic.js';
import dashscope from './dashscope.js';
import openrouter from './openrouter.js';

const ADAPTERS = [anthropic, dashscope, openrouter];

export function registerAll(registerProvider) {
  ADAPTERS.forEach(registerProvider);
}
