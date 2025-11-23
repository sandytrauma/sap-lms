import { NextRequest, NextResponse } from 'next/server';

// The API key is correctly loaded from the environment variables.
const API_KEY = process.env.GOOGLE_GEMINI_API_KEY; 

const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_TEXT = 'gemini-2.5-flash-preview-09-2025';

// Define the expected request body structure
interface RequestBody {
    query: string;
    systemPrompt: string;
    isTTS: boolean;
}

// In the App Router, we use named exports for HTTP methods.
// Since your original function only handled POST, we define an export for POST.
export async function POST(req: NextRequest) {
    if (!API_KEY) {
        return NextResponse.json({ error: 'Server-side API Key is not configured.' }, { status: 500 });
    }

    let body: RequestBody;
    try {
        // In the App Router, request body is read via req.json()
        body = await req.json();
    } catch (e) {
        return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const { query, systemPrompt, isTTS } = body;

    if (!query) {
        return NextResponse.json({ error: 'Missing query parameter.' }, { status: 400 });
    }

    const model = isTTS ? MODEL_TTS : MODEL_TEXT;
    // API Key is correctly used as a query parameter in the server-side fetch
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
            return NextResponse.json({ 
                error: `Gemini API failed: ${errorData.error?.message || 'Unknown error'}`,
                status: geminiResponse.status
            }, { status: geminiResponse.status });
        }

        const data = await geminiResponse.json();
        
        // Pass the raw result back to the client
        return NextResponse.json(data, { status: 200 });
    } catch (error) {
        console.error('Server Fetch Error:', error);
        return NextResponse.json({ error: 'Internal server error while communicating with Gemini.' }, { status: 500 });
    }
}