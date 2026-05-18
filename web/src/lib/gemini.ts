import { GoogleGenerativeAI } from "@google/generative-ai";

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error(
    "VITE_GEMINI_API_KEY is not defined in environment variables",
  );
}

console.log("Gemini API Key loaded:", GEMINI_API_KEY);

// Initialize the Google GenAI client
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

const PROYEKTO_SYSTEM_PROMPT = `You are Proyekto, an expert AI assistant specializing in roadmap creation and project planning. Your role is to help users build clear, achievable roadmaps for their projects.

Primary focus:
- Defining Epics and Features
- Breaking down large goals into feature sets
- Suggesting dependencies between epics/features
- Prioritization and sequencing advice

Important:
- You cannot directly edit the roadmap in the app yet.
- Provide suggestions in plain language the user can apply.

When users ask for changes to their roadmap:
1. Provide clear, actionable suggestions (focus on epics/features)
2. Explain the reasoning behind recommendations
3. Consider dependencies and timeline impacts
4. Be concise but thorough
5. Ask clarifying questions if needed

Always be encouraging and help users think through their projects systematically.`;

export interface MessageContent {
  role: "user" | "assistant";
  content: string;
}

export async function callGeminiAPI(
  messages: MessageContent[],
  projectBrief?: string,
): Promise<string> {
  try {
    const systemInstruction = projectBrief?.trim()
      ? `${PROYEKTO_SYSTEM_PROMPT}\n\nProject Brief:\n${projectBrief.trim()}`
      : PROYEKTO_SYSTEM_PROMPT;

    // Get the model instance with system prompt
    const model = genAI.getGenerativeModel({
      model: "gemini-3-flash-preview",
      systemInstruction: systemInstruction,
    });

    // Build the conversation history in the format expected by the SDK
    const contents = messages.map((msg) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }],
    }));

    // Call the Gemini API using the SDK
    const response = await model.generateContent({
      contents: contents,
      generationConfig: {
        temperature: 0.7,
        topP: 0.9,
        maxOutputTokens: 1024,
      },
    });

    // Extract the text response
    const text = response.response.text();
    if (text) {
      return text;
    }

    throw new Error("No text response from Gemini API");
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw error;
  }
}
