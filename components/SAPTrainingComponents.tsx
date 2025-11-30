"use client";
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { 
    Briefcase, 
    ChevronLeft, 
    CheckCircle, 
    Loader2, 
    ClipboardCheck,
    Clipboard,
    BookOpen,
    MessageCircle,
} from 'lucide-react';
// 💡 NEW IMPORTS: Dedicated Markdown renderer
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import Link from 'next/link';


// --- 1. CONSTANTS & UTILITIES ---

const SAP_BLUE = '#0083B3';
const MODEL_TEXT = 'gemini-2.5-flash';
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY || ""; 

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


/**
 * Generates content using the Gemini API.
 */
const generateContent = async (userQuery: string, courseTitle: string): Promise<string> => {
    if (!apiKey) {
        throw new Error("API Key is missing. Please set NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY.");
    }

    const context = courseTitle 
        ? `The user is studying the SAP course: ${courseTitle}. Reference this course in your answer if relevant.`
        : "The user is on the main dashboard. Provide a general SAP answer.";

    const systemPrompt = `You are a friendly and knowledgeable SAP AI Instructor. Keep your answers concise, informative, and pedagogical. Your response MUST be in detailed, clear Markdown format, using headings (##, ###) and bolding (**). ${context}`;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_TEXT}:generateContent?key=${apiKey}`;
    
    const payload = {
        contents: [{ parts: [{ text: userQuery }] }],
        systemInstruction: { parts: [{ text: systemPrompt }] }, 
        tools: [{ "google_search": {} }], 
        generationConfig: {},
    };

    try {
        const result = await fetchWithExponentialBackoff<{ candidates?: { content?: { parts?: { text: string }[] } }[] }>(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const textPart = result.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
return textPart || "I was unable to retrieve a response. (Content missing or response structured unexpectedly.)";
    } catch (error) {
        console.error("Text API call failed:", error);
        throw new Error("I'm having trouble connecting to the knowledge base right now.");
    }
};

// --- 2. TYPES AND MOCK DATA ---
// (No changes here)

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
// (No changes here)

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

// New Component for the E-Book View
interface ChapterEbookViewProps {
    course: SAPCourse;
    module: Module;
    onBack: () => void;
}

const ChapterEbookView: React.FC<ChapterEbookViewProps> = ({ 
    course, 
    module, 
    onBack, 
}) => {
    const [ebookContent, setEbookContent] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generateEbook = useCallback(async () => {
        setLoading(true);
        setError(null);
        setEbookContent('');
        const query = `Generate a detailed, comprehensive e-book chapter on the SAP concept: "${module.title}". Structure it with clear Markdown headings (##, ###) for topics, key transaction codes (T-Codes), process steps, and a final summary. The content should be pedagogical and professional, suitable for a certification course in SAP ${course.title}.`;
        
        try {
            const content = await generateContent(query, course.title);
            setEbookContent(content);
        } catch (err: any) {
            console.error("E-book generation failed:", err);
            setError(`Could not generate E-book content: ${err.message}. Please check the API key or try again.`);
        } finally {
            setLoading(false);
        }
    }, [module, course.title]);

    useEffect(() => {
        // Automatically generate content when the component mounts
        generateEbook();
    }, [generateEbook]);

    return (
        <div className="bg-white p-6 rounded-xl shadow-lg border border-indigo-200">
            <button 
                onClick={onBack} 
                className="mb-4 text-sm font-semibold transition-colors duration-200 text-[#0083B3] hover:text-[#006b91] flex items-center"
            >
                <ChevronLeft className='w-4 h-4 mr-1'/> Back to {course.title}
            </button>

            <div className="flex justify-between items-center border-b pb-4 mb-4">
                <h2 className="text-3xl font-extrabold text-indigo-700 flex items-center">
                    <BookOpen className='w-6 h-6 mr-2'/> E-Book: {module.title}
                </h2>
                <button
                    onClick={generateEbook}
                    disabled={loading}
                    className="flex items-center px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition disabled:opacity-50 text-sm font-semibold"
                >
                    {loading ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin"/>
                    ) : (
                        <BookOpen className="w-4 h-4 mr-2"/>
                    )}
                    {loading ? 'Generating...' : 'Regenerate Content'}
                </button>
            </div>
            
            {error && (
                <div className="p-4 mb-4 bg-red-100 text-red-700 rounded-lg">
                    <strong>Error:</strong> {error}
                </div>
            )}

            <div className="prose max-w-none text-gray-800 p-4 bg-gray-50 rounded-lg min-h-[300px]">
                {loading && !ebookContent ? (
                    <div className="flex flex-col items-center justify-center h-[300px]">
                        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                        <p className="text-lg text-gray-600">Generating comprehensive lesson for "{module.title}"...</p>
                    </div>
                ) : (
                    // 🚀 THE FIX: Use ReactMarkdown for reliable rendering
                    <ReactMarkdown
                        // rehype-raw is necessary if the markdown output contains raw HTML (e.g., tables, or certain complex structures)
                        // It's generally safe for AI output that is primarily markdown.
                        rehypePlugins={[rehypeRaw]} 
                    >
                        {ebookContent}
                    </ReactMarkdown>
                )}
            </div>
        </div>
    );
}




interface CourseDetailProps {
    course: SAPCourse;
    progress?: ProgressEntry;
    updateProgress: (courseId: string, moduleId: string, isCompleted: boolean) => void;
    onBack: () => void;
    onModuleClick: (moduleId: string) => void;
}

const CourseDetail: React.FC<CourseDetailProps> = ({ course, progress, updateProgress, onBack, onModuleClick }) => {
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
            <h3 className="text-2xl font-bold text-gray-800 mb-4">Course Modules (Click to Study)</h3>
            <div className="space-y-3">
                {course.modules.map((module, index) => {
                    const isCompleted = isModuleCompleted(module.id);
                    return (
                        <div 
                            key={module.id} 
                            className={`p-4 rounded-lg shadow-sm flex justify-between items-center transition-all duration-200 ${isCompleted ? 'bg-green-50 border-l-4 border-green-500' : 'bg-gray-100 border-l-4 border-gray-300 hover:bg-gray-200'}`}
                        >
                            <button
                                onClick={() => onModuleClick(module.id)}
                                className={`flex-grow text-left pr-4 ${isCompleted ? 'text-green-800' : 'text-gray-700'} hover:text-indigo-700 transition duration-150`}
                            >
                                <span className="font-medium">
                                    {index + 1}. {module.title}
                                </span>
                            </button>
                            <div className="flex space-x-2">
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
                                <button
                                    onClick={() => onModuleClick(module.id)}
                                    className="px-3 py-1 text-sm font-semibold rounded-full flex items-center transition-all duration-200 bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                                >
                                    <BookOpen className='w-4 h-4'/>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- 5. MAIN APPLICATION COMPONENT (Refactored) ---

type ViewState = 
    | { type: 'DASHBOARD' }
    | { type: 'COURSE_DETAIL', courseId: string }
    | { type: 'EBOOK', courseId: string, moduleId: string };

const SAPLearningApp: React.FC = () => {
    const { progress, loading, updateProgress, userId } = useUserProgress();
    const [view, setView] = useState<ViewState>({ type: 'DASHBOARD' });

    const currentCourse = useMemo(() => {
        if (view.type === 'COURSE_DETAIL' || view.type === 'EBOOK') {
            return SAP_COURSES.find(c => c.id === view.courseId);
        }
        return undefined;
    }, [view]);

    const handleViewCourse = (courseId: string) => {
        setView({ type: 'COURSE_DETAIL', courseId });
    };

    const handleViewModule = (courseId: string, moduleId: string) => {
        setView({ type: 'EBOOK', courseId, moduleId });
    };

    const handleBack = () => {
        if (view.type === 'EBOOK') {
            setView({ type: 'COURSE_DETAIL', courseId: view.courseId });
        } else {
            setView({ type: 'DASHBOARD' });
        }
    };

    if (loading) {
        return <LoadingSpinner />;
    }

    const appBody = (() => {
        switch (view.type) {
            case 'DASHBOARD':
                return (
                    <>
                        <h1 className="text-4xl font-extrabold text-gray-800 mb-6 flex items-center">
                            <Link href="/">
                            <Briefcase className="w-8 h-8 mr-3 text-[#0083B3]" /> SAP Learning Hub
                            </Link>
                        </h1>
                        <p className="text-sm text-gray-500 mb-8">
                            Welcome back, User {userId.substring(0, 8)}... | Select a course to begin your certification journey.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {SAP_COURSES.map(course => (
                                <CourseCard 
                                    key={course.id} 
                                    course={course} 
                                    progress={progress.find(p => p.courseId === course.id)}
                                    onView={handleViewCourse}
                                />
                            ))}
                        </div>
                    </>
                );

            case 'COURSE_DETAIL':
                if (!currentCourse) return <p>Course not found.</p>;
                return (
                    <div className="grid grid-cols-1 gap-8">
                        <CourseDetail
                            course={currentCourse}
                            progress={progress.find(p => p.courseId === currentCourse.id)}
                            updateProgress={updateProgress}
                            onBack={handleBack}
                            onModuleClick={(moduleId) => handleViewModule(currentCourse.id, moduleId)}
                        />
                    </div>
                );

            case 'EBOOK':
                const module = currentCourse?.modules.find(m => m.id === view.moduleId);
                if (!currentCourse || !module) return <p>Module or Course not found.</p>;
                return (
                    <div className="grid grid-cols-1 gap-8">
                        <ChapterEbookView
                            course={currentCourse}
                            module={module}
                            onBack={handleBack}
                        />
                    </div>
                );
        }
    })();

    return (
        <div className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto">
                {appBody}
            </div>
        </div>
    );
};

export default SAPLearningApp;