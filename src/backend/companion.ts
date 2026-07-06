import { GoogleGenAI } from '@google/genai';

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable is not configured. Please add it under Settings > Secrets.');
    }
    aiClient = new GoogleGenAI({
      apiKey: key,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
  }
  return aiClient;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

export interface CompanionContext {
  activeTab: string;
  repoInitialized: boolean;
  currentBranch: string | null;
  stagedCount: number;
  modifiedCount: number;
  conflictCount: number;
  currentLessonId?: string;
  currentLessonTitle?: string;
}

export async function* generateBranchyResponseStream(
  userMessage: string,
  history: ChatMessage[],
  context: CompanionContext
): AsyncGenerator<string, void, unknown> {
  let ai;
  try {
    ai = getAiClient();
  } catch (err: any) {
    yield `Branchy is taking a quick nap! (Error: ${err.message || 'API key missing'})`;
    return;
  }
  
  // Format the current workspace state nicely for the LLM context
  const stateSummary = `
- Tab currently active: "${context.activeTab}"
- Repository .gitclone initialized: ${context.repoInitialized ? 'Yes' : 'No'}
- Current Active Branch: ${context.currentBranch || 'None'}
- Files in staging area (stagedCount): ${context.stagedCount}
- Modified unstaged files (modifiedCount): ${context.modifiedCount}
- Merge conflicts active (conflictCount): ${context.conflictCount}
- Active Academy Lesson: ${context.currentLessonId ? `"${context.currentLessonTitle}" (ID: ${context.currentLessonId})` : 'None/Sandbox Mode'}
  `.trim();

  const systemInstruction = `
You are Branchy, the charming, clever, and enthusiastic little fox companion who lives inside GitClone, an interactive Version Control System (VCS) learning academy.

Your primary goal is to provide a highly accurate, direct, and "to-the-point" answer to the user's input.

Guidelines for your response:
1. Prioritize answering the user's specific question or query first and foremost. Be precise, clear, and technically accurate.
2. Avoid generic advice or pre-scripted suggestions when the user asks a specific question. Answer their prompt directly and cleanly.
3. Keep explanations crisp, direct, and brief (2-3 sentences is perfect). No unnecessary fluff.
4. If they just say hello, ask "what should I do next?", or ask for general help, you can use the current workspace state below to offer a specific foxy tip:
   - If the repository is not initialized, encourage them to click "Initialize Clean Sandbox" or "Start VCS Academy".
   - If they have unstaged modifications (modifiedCount > 0), suggest staging them.
   - If they have staged files (stagedCount > 0) but no recent commit, suggest running "Commit" to save their snapshot.
   - If there is a merge conflict (conflictCount > 0), guide them to check conflict files.
   - If they are in a lesson, give them a helpful hint for that lesson.
5. Maintain your charming fox persona with occasional subtle foxy expressions, but never let it distract from the technical accuracy and directness of your answer.

Here is the current GitClone workspace state for context:
${stateSummary}
`.trim();

  // Prepare contents array
  const contents = [];

  const recentHistory = history.slice(-6).filter(msg => msg.text && msg.text.trim());
  for (const msg of recentHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    });
  }

  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  try {
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3.5-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 250,
      }
    });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        yield chunk.text;
      }
    }
  } catch (err: any) {
    console.error('Error in generateBranchyResponseStream:', err);
    yield `Branchy's signal is fading! (Error: ${err.message || 'API connection failed'})`;
  }
}

export async function generateBranchyResponse(
  userMessage: string,
  history: ChatMessage[],
  context: CompanionContext
): Promise<string> {
  const ai = getAiClient();
  
  // Format the current workspace state nicely for the LLM context
  const stateSummary = `
- Tab currently active: "${context.activeTab}"
- Repository .gitclone initialized: ${context.repoInitialized ? 'Yes' : 'No'}
- Current Active Branch: ${context.currentBranch || 'None'}
- Files in staging area (stagedCount): ${context.stagedCount}
- Modified unstaged files (modifiedCount): ${context.modifiedCount}
- Merge conflicts active (conflictCount): ${context.conflictCount}
- Active Academy Lesson: ${context.currentLessonId ? `"${context.currentLessonTitle}" (ID: ${context.currentLessonId})` : 'None/Sandbox Mode'}
  `.trim();

  const systemInstruction = `
You are Branchy, the charming, clever, and enthusiastic little fox companion who lives inside GitClone, an interactive Version Control System (VCS) learning academy.

Your primary goal is to provide a highly accurate, direct, and "to-the-point" answer to the user's input.

Guidelines for your response:
1. Prioritize answering the user's specific question or query first and foremost. Be precise, clear, and technically accurate.
2. Avoid generic advice or pre-scripted suggestions when the user asks a specific question. Answer their prompt directly and cleanly.
3. Keep explanations crisp, direct, and brief (2-3 sentences is perfect). No unnecessary fluff.
4. If they just say hello, ask "what should I do next?", or ask for general help, you can use the current workspace state below to offer a specific foxy tip:
   - If the repository is not initialized, encourage them to click "Initialize Clean Sandbox" or "Start VCS Academy".
   - If they have unstaged modifications (modifiedCount > 0), suggest staging them.
   - If they have staged files (stagedCount > 0) but no recent commit, suggest running "Commit" to save their snapshot.
   - If there is a merge conflict (conflictCount > 0), guide them to check conflict files.
   - If they are in a lesson, give them a helpful hint for that lesson.
5. Maintain your charming fox persona with occasional subtle foxy expressions, but never let it distract from the technical accuracy and directness of your answer.

Here is the current GitClone workspace state for context:
${stateSummary}
`.trim();

  // Prepare contents array for generateContent following @google/genai guidelines
  const contents = [];

  // Add relevant history if provided (limit to last 6 messages to keep it fast and within context)
  const recentHistory = history.slice(-6).filter(msg => msg.text && msg.text.trim());
  for (const msg of recentHistory) {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    });
  }

  // Add the current user query
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: contents,
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.7,
        maxOutputTokens: 250,
      }
    });

    return response.text || "Hmm, my whiskers got tangled! Can you try saying that again?";
  } catch (err: any) {
    console.error('Error in generateBranchyResponse:', err);
    return `Branchy is taking a quick nap! (Error: ${err.message || 'API connection failed'})`;
  }
}
