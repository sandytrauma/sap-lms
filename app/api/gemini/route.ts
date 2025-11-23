// /pages/api/gemini.ts (for Pages Router)
// or /app/api/gemini/route.ts (for App Router - needs minor changes like NextResponse)

import { NextApiRequest, NextApiResponse } from 'next';

// Use a private key for the server-side API call
const API_KEY = process.env.GOOGLE_GEMINI_API_KEY; 

const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_TEXT = 'gemini-2.5-flash-preview-09-2025';

// Define the expected request body structure
interface GeminiApiRequest extends NextApiRequest {
    body: {
        query: string;
        systemPrompt: string;
        isTTS: boolean;
    };
}

export default async function handler(
    req: GeminiApiRequest,
    res: NextApiResponse
) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    if (!API_KEY) {
        return res.status(500).json({ error: 'Server-side API Key is not configured.' });
    }

    const { query, systemPrompt, isTTS } = req.body;

    if (!query) {
        return res.status(400).json({ error: 'Missing query parameter.' });
    }

    const model = isTTS ? MODEL_TTS : MODEL_TEXT;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    
    let payload: any = {
        contents: [{ parts: [{ text: query }] }],
        model: model
    };

    if (isTTS) {
        // TTS Configuration
        payload.generationConfig = {
            responseModalities: ["AUDIO"],
            speechConfig: {
                voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: "Charon" } 
                }
            }
        };
    } else {
        // Text Generation Configuration
        payload.systemInstruction = { parts: [{ text: systemPrompt }] };
        payload.tools = [{ "google_search": {} }];
    }

    try {
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!geminiResponse.ok) {
            const errorData = await geminiResponse.json();
            console.error('Gemini API Error:', errorData);
            return res.status(geminiResponse.status).json({ 
                error: `Gemini API failed: ${errorData.error?.message || 'Unknown error'}`,
                status: geminiResponse.status
            });
        }

        const data = await geminiResponse.json();
        
        // Pass the raw result back to the client
        return res.status(200).json(data);
    } catch (error) {
        console.error('Server Fetch Error:', error);
        return res.status(500).json({ error: 'Internal server error while communicating with Gemini.' });
    }
}