"use client";
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
    Briefcase, 
    ChevronLeft, 
    CheckCircle, 
    Loader2, 
    MessageCircle, 
    Volume2, 
    VolumeX,
    ClipboardCheck,
    Clipboard,
} from 'lucide-react';

// --- 1. CONSTANTS & UTILITIES ---

const SAP_BLUE = '#0083B3';
// Models for Gemini API
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_TEXT = 'gemini-2.5-flash-preview-09-2025';

// API Key is correctly read from the environment variable
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY || ""; 

// Utility to convert Base64 to ArrayBuffer
const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// Utility to convert PCM audio data to WAV format blob
const pcmToWav = (pcm16: Int16Array, sampleRate: number): Blob => {
    const numChannels = 1;
    const sampleSize = 2; // 16-bit PCM
    const buffer = new ArrayBuffer(44 + pcm16.length * sampleSize);
    const view = new DataView(buffer);

    // RIFF identifier
    writeString(view, 0, 'RIFF');
    // File size
    view.setUint32(4, 36 + pcm16.length * sampleSize, true);
    // WAV identifier
    writeString(view, 8, 'WAVE');
    // format chunk identifier
    writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (1 = PCM)
    view.setUint16(20, 1, true);
    // number of channels
    view.setUint16(22, numChannels, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * numChannels * sampleSize, true);
    // block align (num channels * bytes per sample)
    view.setUint16(32, numChannels * sampleSize, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, pcm16.length * sampleSize, true);

    // Write PCM data
    let offset = 44;
    for (let i = 0; i < pcm16.length; i++, offset += 2) {
        view.setInt16(offset, pcm16[i], true);
    }

    return new Blob([view], { type: 'audio/wav' });
};

// Helper function for writing strings to DataView
const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
};

// Utility for robust fetching with backoff
async function fetchWithExponentialBackoff<T>(
    url: string, 
    options: RequestInit, 
    maxRetries = 5
): Promise<T> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (!response.ok) {
                const errorData = await response.json();
                if (response.status === 429 && i < maxRetries - 1) {
                    const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                throw new Error(`API request failed: ${response.status} ${response.statusText} - ${errorData.error?.message || 'Unknown error'}`);
            }
            return await response.json();
        } catch (error) {
            if (i === maxRetries - 1) {
                throw error;
            }
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    // Should never reach here if maxRetries > 0
    throw new Error("Maximum retries reached.");
}

// --- 2. TYPES AND MOCK DATA ---

interface Module {
    title: string;
    id: string;
}

interface SAPCourse {
    id: string;
    title: string;
    domain: 'Logistics' | 'Finance' | 'Technical';
    totalModules: number;
    modules: Module[];
    description: string;
}

interface ProgressEntry {
    courseId: string;
    completedModules: string[]; // Array of Module IDs
}

const SAP_COURSES: SAPCourse[] = [
    {
        id: 'mm',
        title: 'SAP MM (Materials Management)',
        domain: 'Logistics',
        totalModules: 5,
        description: 'Comprehensive guide to procurement processes, inventory management, and invoice verification in SAP.',
        modules: [
            { id: 'mm-1', title: 'Master Data Setup (Vendor & Material)' },
            { id: 'mm-2', title: 'Purchase Requisition & Order Processing' },
            { id: 'mm-3', title: 'Goods Receipt and Movement Types' },
            { id: 'mm-4', title: 'Invoice Verification (LIV)' },
            { id: 'mm-5', title: 'Inventory Management and Physical Inventory' },
        ]
    },
    {
        id: 'fico',
        title: 'SAP FI/CO (Financial Accounting/Controlling)',
        domain: 'Finance',
        totalModules: 6,
        description: 'Learn General Ledger, Accounts Payable/Receivable, Cost Center Accounting, and Internal Orders.',
        modules: [
            { id: 'fi-1', title: 'General Ledger Configuration' },
            { id: 'fi-2', title: 'Accounts Payable (AP) Process' },
            { id: 'fi-3', title: 'Accounts Receivable (AR) Process' },
            { id: 'co-4', title: 'Cost Center Accounting (CCA)' },
            { id: 'co-5', title: 'Profit Center Accounting (PCA)' },
            { id: 'co-6', title: 'Internal Orders and Settlements' },
        ]
    },
    {
        id: 'sd',
        title: 'SAP SD (Sales and Distribution)',
        domain: 'Logistics',
        totalModules: 4,
        description: 'Master the Order-to-Cash process including sales order creation, shipping, and billing.',
        modules: [
            { id: 'sd-1', title: 'Sales Order Creation and Types' },
            { id: 'sd-2', title: 'Pricing and Condition Techniques' },
            { id: 'sd-3', title: 'Delivery Processing and Picking' },
            { id: 'sd-4', title: 'Billing and Invoicing' },
        ]
    },
];

// --- 3. LOCAL STORAGE DATA HOOK ---

const USER_ID_KEY = 'sap_user_id';
const PROGRESS_KEY = 'sap_progress';

const useUserProgress = () => {
    const [progress, setProgress] = useState<ProgressEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState('Initializing...');

    // Load initial data and set user ID from localStorage
    useEffect(() => {
        let storedUserId = localStorage.getItem(USER_ID_KEY);
        if (!storedUserId) {
            storedUserId = crypto.randomUUID();
            localStorage.setItem(USER_ID_KEY, storedUserId);
        }
        setUserId(storedUserId);

        const storedProgress = localStorage.getItem(PROGRESS_KEY);
        if (storedProgress) {
            try {
                setProgress(JSON.parse(storedProgress));
            } catch (error) {
                console.error("Error parsing progress from localStorage:", error);
                setProgress([]);
            }
        }
        setLoading(false);
    }, []);

    // Update localStorage whenever progress state changes
    useEffect(() => {
        if (!loading) {
            localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
        }
    }, [progress, loading]);

    // Update function for components
    const updateProgress = useCallback((courseId: string, moduleId: string, isCompleted: boolean) => {
        setProgress(prevProgress => {
            let newProgress = [...prevProgress];
            let courseIndex = newProgress.findIndex(p => p.courseId === courseId);

            if (courseIndex === -1) {
                // Course not tracked yet, create new entry
                const newEntry: ProgressEntry = { 
                    courseId, 
                    completedModules: isCompleted ? [moduleId] : [] 
                };
                newProgress.push(newEntry);
            } else {
                // Course exists, update modules
                let currentEntry = newProgress[courseIndex];
                let newCompletedModules = [...currentEntry.completedModules];

                if (isCompleted && !newCompletedModules.includes(moduleId)) {
                    newCompletedModules.push(moduleId);
                } else if (!isCompleted) {
                    newCompletedModules = newCompletedModules.filter(id => id !== moduleId);
                }
                newProgress[courseIndex] = { ...currentEntry, completedModules: newCompletedModules };
            }

            return newProgress;
        });
    }, []);

    return { progress, loading, updateProgress, userId };
};

// --- 4. UI COMPONENTS ---

const LoadingSpinner: React.FC = () => (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
        <Loader2 className="w-10 h-10 text-[#0083B3] animate-spin mb-4" />
        <p className="text-gray-600 font-semibold">Loading SAP resources...</p>
    </div>
);

interface CourseCardProps {
    course: SAPCourse;
    progress?: ProgressEntry;
    onView: (id: string) => void;
}

const CourseCard: React.FC<CourseCardProps> = ({ course, progress, onView }) => {
    const completedCount = progress?.completedModules.length || 0;
    const completionRatio = (completedCount / course.totalModules) * 100;
    const isCompleted = completedCount === course.totalModules;

    let domainColor = 'bg-green-500';
    if (course.domain === 'Finance') domainColor = 'bg-yellow-500';
    if (course.domain === 'Technical') domainColor = 'bg-red-500';

    return (
        <div 
            className={`bg-white rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden transform hover:-translate-y-1 ${isCompleted ? 'border-4 border-green-400' : 'border border-gray-100'}`}
            onClick={() => onView(course.id)}
        >
            <div className={`p-4 ${domainColor} text-white text-sm font-bold`}>
                {course.domain}
            </div>
            <div className="p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-2">{course.title}</h3>
                <p className="text-sm text-gray-600 mb-4 line-clamp-2">{course.description}</p>
                
                <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-medium text-gray-500">
                        {isCompleted ? 'Completed' : `${completedCount}/${course.totalModules} Modules`}
                    </span>
                    {isCompleted && <CheckCircle className='w-5 h-5 text-green-500' />}
                </div>

                <div className="w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                        className="h-2.5 rounded-full transition-all duration-500" 
                        style={{ width: `${completionRatio}%`, backgroundColor: SAP_BLUE }}
                    ></div>
                </div>
            </div>
        </div>
    );
};


interface CourseDetailProps {
    course: SAPCourse;
    progress?: ProgressEntry;
    updateProgress: (courseId: string, moduleId: string, isCompleted: boolean) => void;
    onBack: () => void;
}

const CourseDetail: React.FC<CourseDetailProps> = ({ course, progress, updateProgress, onBack }) => {
    const isModuleCompleted = (moduleId: string) => 
        progress?.completedModules.includes(moduleId) || false;

    const handleToggleCompletion = (moduleId: string, isCompleted: boolean) => {
        updateProgress(course.id, moduleId, isCompleted);
    };

    const completedCount = progress?.completedModules.length || 0;
    const completionRatio = (completedCount / course.totalModules) * 100;
    const isCourseCompleted = completedCount === course.totalModules;

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
            <button 
                onClick={onBack} 
                className="mb-4 text-sm font-semibold transition-colors duration-200 text-[#0083B3] hover:text-[#006b91] flex items-center"
            >
                <ChevronLeft className='w-4 h-4 mr-1'/> Back to Dashboard
            </button>
            
            <div className="flex justify-between items-start border-b pb-4 mb-4">
                <div>
                    <h2 className="text-3xl font-extrabold text-gray-800">{course.title}</h2>
                    <p className="text-md text-gray-600 mt-1">{course.description}</p>
                </div>
                {isCourseCompleted && (
                    <div className="text-green-600 font-bold flex items-center ml-4 p-2 bg-green-100 rounded-lg">
                        <ClipboardCheck className='w-5 h-5 mr-1'/> Certified!
                    </div>
                )}
            </div>

            {/* Progress Bar */}
            <div className="mb-6 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-gray-700">Your Progress</span>
                    <span className="font-bold text-lg" style={{ color: SAP_BLUE }}>{completionRatio.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                        className="h-3 rounded-full transition-all duration-500" 
                        style={{ width: `${completionRatio}%`, backgroundColor: SAP_BLUE }}
                    ></div>
                </div>
            </div>

            {/* Modules List */}
            <h3 className="text-2xl font-bold text-gray-800 mb-4">Course Modules</h3>
            <div className="space-y-3">
                {course.modules.map((module, index) => {
                    const isCompleted = isModuleCompleted(module.id);
                    return (
                        <div 
                            key={module.id} 
                            className={`p-4 rounded-lg shadow-sm flex justify-between items-center transition-all duration-200 ${isCompleted ? 'bg-green-50 border-l-4 border-green-500' : 'bg-gray-100 border-l-4 border-gray-300 hover:bg-gray-200'}`}
                        >
                            <span className={`font-medium ${isCompleted ? 'text-green-800' : 'text-gray-700'}`}>
                                {index + 1}. {module.title}
                            </span>
                            <button
                                onClick={() => handleToggleCompletion(module.id, !isCompleted)}
                                className={`px-3 py-1 text-sm font-semibold rounded-full flex items-center transition-all duration-200 ${
                                    isCompleted 
                                        ? 'bg-green-500 text-white hover:bg-green-600' 
                                        : 'bg-white text-[#0083B3] border border-[#0083B3] hover:bg-[#0083B3] hover:text-white'
                                }`}
                            >
                                {isCompleted ? (
                                    <>
                                        <CheckCircle className='w-4 h-4 mr-1'/> Completed
                                    </>
                                ) : (
                                    <>
                                        <Clipboard className='w-4 h-4 mr-1'/> Mark Done
                                    </>
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

interface VoiceAssistantProps {
    currentCourseId: string | null;
}

const VoiceAssistant: React.FC<VoiceAssistantProps> = ({ currentCourseId }) => {
    const [input, setInput] = useState('');
    const [response, setResponse] = useState('');
    const [loading, setLoading] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const currentCourse = useMemo(() => 
        SAP_COURSES.find(c => c.id === currentCourseId), [currentCourseId]);

    const handleStopSpeaking = () => {
        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setIsSpeaking(false);
        }
    };

    const handleSpeak = useCallback(async (textToSpeak: string) => {
        handleStopSpeaking(); // Stop any existing audio

        if (textToSpeak.length > 500) {
            textToSpeak = textToSpeak.substring(0, 500) + "... (response truncated for TTS)";
        }
        
        setIsSpeaking(true);
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_TTS}:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{ parts: [{ text: textToSpeak }] }],
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        // Using a clear, informative voice
                        prebuiltVoiceConfig: { voiceName: "Charon" } 
                    }
                }
            },
            model: MODEL_TTS
        };

        try {
            const result = await fetchWithExponentialBackoff<{ 
                candidates?: { 
                    content?: { 
                        parts?: { 
                            inlineData?: { 
                                data: string, 
                                mimeType: string 
                            } 
                        }[] 
                    } 
                }[] 
            }>(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const part = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = part?.inlineData?.data;
            const mimeType = part?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/")) {
                const rateMatch = mimeType.match(/rate=(\d+)/);
                const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 16000; // Default to 16000 if not specified

                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                
                const audioUrl = URL.createObjectURL(wavBlob);
                if (audioRef.current) {
                    audioRef.current.src = audioUrl;
                    audioRef.current.onended = () => setIsSpeaking(false);
                    await audioRef.current.play();
                }
            } else {
                console.error("TTS response error: No audio data found.");
                setResponse("Sorry, I couldn't generate the voice response.");
            }
        } catch (error) {
            console.error("TTS API call failed:", error);
            setResponse("An error occurred while connecting to the voice service.");
        } finally {
            // Only set speaking false if audio isn't playing
            if (audioRef.current && audioRef.current.paused) {
                setIsSpeaking(false);
            }
        }
    }, []);

    const handleSubmit = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!input.trim() || loading) return;

        // API Key check
        if (!apiKey) {
            setResponse("API Key is missing. Please set NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY.");
            return;
        }

        const currentInput = input;
        setInput('');
        setResponse('');
        handleStopSpeaking();
        setLoading(true);

        const context = currentCourse 
            ? `The user is currently studying the SAP course: ${currentCourse.title} (${currentCourse.description}). Reference this course in your answer if relevant.`
            : "The user is on the main dashboard. Provide a general SAP answer.";

        const systemPrompt = `You are a friendly and knowledgeable SAP AI Instructor. Keep your answers concise, informative, and pedagogical. Your response MUST be in simple Markdown format. ${context}`;
        const userQuery = currentInput;

        // Using the API key via URL parameter
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_TEXT}:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: [{ parts: [{ text: userQuery }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
            tools: [{ "google_search": {} }], // Use grounding for up-to-date SAP info
        };

        try {
            const result = await fetchWithExponentialBackoff<{ candidates?: { content?: { parts?: { text: string }[] } }[] }>(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text || "I was unable to retrieve a response.";
            setResponse(aiText);
            
            // Auto-speak the response
            handleSpeak(aiText);

        } catch (error) {
            console.error("Text API call failed:", error);
            setResponse("I'm having trouble connecting to the knowledge base right now.");
        } finally {
            setLoading(false);
        }
    };

    // Initialize audio element once
    useEffect(() => {
        if (!audioRef.current) {
            audioRef.current = new Audio();
        }
    }, []);

    return (
        <div className="bg-white p-5 rounded-xl shadow-lg border-2 border-indigo-200">
            <h3 className="text-xl font-bold text-indigo-700 mb-3 flex items-center">
                <MessageCircle className='w-5 h-5 mr-2'/> AI Voice Tutor
            </h3>
            
            <p className="text-xs text-gray-500 mb-3">
                {currentCourse ? 
                    `Context: ${currentCourse.title}` : 
                    "Context: Dashboard (General SAP)"
                }
            </p>

            <form onSubmit={handleSubmit} className="mb-4">
                <input
                    type="text"
                    placeholder="Ask an SAP question..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    className="w-full p-2 border border-indigo-300 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 transition duration-150 shadow-inner text-sm mb-2"
                    disabled={loading}
                />
                <div className="flex justify-between gap-2">
                    <button
                        type="submit"
                        disabled={loading || !input.trim()}
                        className="flex-grow bg-indigo-600 text-white font-semibold py-2 rounded-lg hover:bg-indigo-700 transition duration-300 ease-in-out shadow-md disabled:opacity-50 flex items-center justify-center text-sm"
                    >
                        {loading ? (
                            <Loader2 className="w-4 h-4 mr-2 animate-spin"/>
                        ) : (
                            <MessageCircle className='w-4 h-4 mr-2'/>
                        )}
                        Ask Tutor
                    </button>
                    <button
                        type="button"
                        onClick={isSpeaking ? handleStopSpeaking : () => response && handleSpeak(response)}
                        disabled={loading || !response}
                        className={`p-2 rounded-lg transition duration-200 shadow-md flex items-center justify-center ${isSpeaking ? 'bg-red-500 text-white hover:bg-red-600' : 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'}`}
                        title={isSpeaking ? "Stop Speaking" : "Replay Response"}
                    >
                        {isSpeaking ? <VolumeX className='w-5 h-5'/> : <Volume2 className='w-5 h-5'/>}
                    </button>
                </div>
            </form>

            <div className={`p-3 rounded-lg border ${response ? 'bg-indigo-50 border-indigo-300' : 'bg-gray-50 border-gray-200'} whitespace-pre-wrap text-sm`}>
                <p className="font-semibold text-indigo-700 mb-1">Response:</p>
                <p className="text-gray-800">{response || 'Your answers will appear here. Ask about an SAP t-code or concept!'}</p>
            </div>
        </div>
    );
};

// --- 5. MAIN APPLICATION COMPONENT ---

const App: React.FC = () => {
    const [viewedCourseId, setViewedCourseId] = useState<string | null>(null);
    // Uses localStorage for non-persistent progress storage
    const { progress, loading, updateProgress, userId } = useUserProgress();

    const currentCourse = useMemo(() => {
        return SAP_COURSES.find(c => c.id === viewedCourseId) || null;
    }, [viewedCourseId]);

    if (loading) {
        return <LoadingSpinner />;
    }

    const handleViewCourse = (id: string) => setViewedCourseId(id);
    const handleBackToDashboard = () => setViewedCourseId(null);
    
    const totalCourses = SAP_COURSES.length;
    
    const completedCourses = progress.filter(p => {
        const course = SAP_COURSES.find(c => c.id === p.courseId);
        // Check if the progress entry's completed modules match the total modules defined in the course data
        return course && p.completedModules.length === course.totalModules;
    }).length;
    
    const completionRatio = totalCourses > 0 ? (completedCourses / totalCourses) * 100 : 0;
    
    // Dashboard View
    if (!viewedCourseId) {
        return (
            <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans">
                <header className="mb-8">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-white p-4 rounded-xl shadow-lg border-b-4 border-[#0083B3]">
                        <h1 className="text-3xl font-extrabold text-gray-800 mb-2 sm:mb-0">
                            <Briefcase className='w-6 h-6 inline-block mr-2 text-[#0083B3]'/> SAP Skill Builder
                        </h1>
                        <div className="text-right">
                             <p className="text-xs text-red-500 font-bold">WARNING: Progress is stored locally on this device only.</p>
                            <p className="font-mono text-xs text-gray-700 break-all">User ID: {userId}</p>
                        </div>
                    </div>
                </header>

                <main className="container mx-auto">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                        {/* Stats Card */}
                        <div className="md:col-span-3 bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                            <h2 className="text-xl font-bold text-gray-800 mb-4">My SAP Certification Progress</h2>
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                <div>
                                    <p className="text-5xl font-extrabold" style={{ color: SAP_BLUE }}>{completedCourses}/{totalCourses}</p>
                                    <p className="text-gray-500 mt-1">SAP Courses Completed</p>
                                </div>
                                <div className="w-full sm:w-1/2">
                                    <div className="w-full bg-gray-200 rounded-full h-3">
                                        <div 
                                            className="h-3 rounded-full transition-all duration-500" 
                                            style={{ width: `${completionRatio}%`, backgroundColor: SAP_BLUE }}
                                        ></div>
                                    </div>
                                    <p className="text-sm font-medium text-gray-700 mt-2 text-right">{completionRatio.toFixed(0)}% Overall</p>
                                </div>
                            </div>
                        </div>

                        {/* AI Voice Tutor Widget - Always available on dashboard */}
                        <div className="md:col-span-1">
                            <VoiceAssistant currentCourseId={null} />
                        </div>
                    </div>

                    <h2 className="text-2xl font-bold text-gray-800 mb-4">Available SAP Training</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {SAP_COURSES.map(course => (
                            <CourseCard 
                                key={course.id} 
                                course={course} 
                                progress={progress.find(p => p.courseId === course.id)}
                                onView={handleViewCourse}
                            />
                        ))}
                    </div>
                </main>
            </div>
        );
    }

    // Course Detail View
    if (!currentCourse) {
        // Defensive: fallback if course not found
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 md:p-8 font-sans">
                <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 text-center">
                    <h2 className="text-2xl font-bold text-red-600 mb-4">Course not found</h2>
                    <button 
                        onClick={handleBackToDashboard} 
                        className="px-4 py-2 font-semibold transition-all duration-200 rounded-lg shadow-sm hover:shadow-md bg-[#0083B3] text-white hover:bg-[#006b91] flex items-center mx-auto"
                    >
                        <ChevronLeft className='w-4 h-4 mr-2'/> Back to Dashboard
                    </button>
                </div>
            </div>
        );
    }
    return (
        <div className="min-h-screen bg-gray-50 p-4 md:p-8 font-sans">
            <main className="container mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="md:col-span-3">
                    <CourseDetail
                        course={currentCourse}
                        progress={progress.find(p => p.courseId === currentCourse.id)}
                        updateProgress={updateProgress}
                        onBack={handleBackToDashboard}
                    />
                </div>
                <div className="md:col-span-1">
                    <VoiceAssistant currentCourseId={currentCourse.id} />
                    {/* User Info Card */}
                    <div className="bg-white p-4 rounded-xl shadow-lg border border-gray-100 mt-6 text-sm">
                         <h3 className="font-bold text-gray-800 mb-2">User Session</h3>
                         <p className="text-xs text-red-500 font-bold mb-1">Progress is NOT cloud-saved.</p>
                         <p className="font-mono text-xs text-gray-700 break-all">User ID: {userId}</p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;