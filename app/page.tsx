"use client";
import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import SAPTrainingComponents from '@/components/SAPTrainingComponents';
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
    BookOpen, // New Icon for Chapters
} from 'lucide-react';
import Link from 'next/link';

// --- 1. CONSTANTS & UTILITIES ---

const SAP_BLUE = '#0083B3';
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';
const MODEL_TEXT = 'gemini-2.5-flash-preview-09-2025';
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

// --- 2. TYPES AND MOCK DATA (UPDATED) ---

interface Chapter {
    id: string;
    title: string;
    content: string; // The text content the AI will use to "teach" the user
}

interface Module {
    name: string; // Renamed 'title' to 'name'
    id: string;
    chapters: Chapter[]; // New: List of chapters
}

interface SAPCourse {
    id: string;
    title: string;
    domain: 'Logistics' | 'Finance' | 'Technical' | 'Cross-Functional'; // Added a domain
    totalModules: number;
    modules: Module[];
    description: string;
}

interface ProgressEntry {
    courseId: string;
    // This array will now store completed CHAPTER IDs, not Module IDs
    completedModules: string[]; 
}

const SAP_COURSES: SAPCourse[] = [
    {
        id: 'mm',
        title: 'SAP MM (Materials Management)',
        domain: 'Logistics',
        totalModules: 5, 
        description: 'Comprehensive guide to procurement processes, inventory management, and invoice verification in SAP.',
        modules: [
            { 
                id: 'mm-1', 
                name: 'Master Data Setup (Vendor & Material)',
                chapters: [
                    { id: 'mm-c1.1', title: 'Material Master Views & Creation', content: "The Material Master is central to logistics. It defines how a material is managed. Key views are Basic Data, Purchasing, Accounting, and Warehouse Management. T-code: MM01." },
                    { id: 'mm-c1.2', title: 'Vendor Master (Business Partner)', content: "The Vendor Master is now part of the Business Partner (BP) concept in S/4HANA. It holds all supplier-related data, like address, payment terms, and purchasing data. T-code: BP." },
                ]
            },
            { 
                id: 'mm-2', 
                name: 'Purchase Requisition & Order Processing',
                chapters: [
                    { id: 'mm-c2.1', title: 'Creating a Purchase Requisition (PR)', content: "A Purchase Requisition is an internal document requesting a material or service. It's the first formal step in procurement. T-code: ME51N." },
                    { id: 'mm-c2.2', title: 'Source Determination & Purchase Order (PO)', content: "The Purchase Order is a formal, external document sent to a vendor, committing the company to the purchase. T-code: ME21N." },
                    { id: 'mm-c2.3', title: 'Contract & Scheduling Agreement', content: "These are long-term procurement agreements with vendors, simplifying future PO creation." },
                ]
            },
            { 
                id: 'mm-3', 
                name: 'Goods Receipt and Movement Types',
                chapters: [
                    { id: 'mm-c3.1', title: 'Performing a Goods Receipt (GR)', content: "The Goods Receipt documents the physical movement of goods into inventory, referencing a Purchase Order. This creates a material document. T-code: MIGO." },
                    { id: 'mm-c3.2', title: 'Understanding Movement Types', content: "Movement types (e.g., 101 for GR, 201 for consumption) control how goods movement is recorded in the system and the corresponding General Ledger postings." },
                ]
            },
            { 
                id: 'mm-4', 
                name: 'Invoice Verification (LIV)',
                chapters: [
                    { id: 'mm-c4.1', title: 'Entering a Vendor Invoice', content: "Invoice Verification is the final step in the P2P cycle, matching the invoice against the PO and GR to ensure accuracy. This posts the financial liability. T-code: MIRO." },
                    { id: 'mm-c4.2', title: 'Three-Way Match Concept', content: "The three-way match verifies the data between the Purchase Order, the Goods Receipt, and the Invoice before payment is approved." },
                ]
            },
            { 
                id: 'mm-5', 
                name: 'Inventory Management and Physical Inventory',
                chapters: [
                    { id: 'mm-c5.1', title: 'Stock Types and Valuation', content: "Stock can be unrestricted, quality inspection, or blocked. Valuation defines the cost of the material." },
                    { id: 'mm-c5.2', title: 'Physical Inventory Process', content: "This process ensures that the physical stock matches the system stock. Key steps include document creation, counting, and posting differences. T-code: MI01, MI04, MI07." },
                ]
            },
        ]
    },
    {
        id: 'fico',
        title: 'SAP FI/CO (Financial Accounting/Controlling)',
        domain: 'Finance',
        totalModules: 6,
        description: 'Learn General Ledger, Accounts Payable/Receivable, Cost Center Accounting, and Internal Orders.',
        modules: [
            { 
                id: 'fi-1', 
                name: 'General Ledger Configuration',
                chapters: [
                    { id: 'fi-c1.1', title: 'Chart of Accounts Structure', content: "The Chart of Accounts (CoA) is the list of all General Ledger accounts used by a company. It is a fundamental FI component. T-code: OB13." },
                    { id: 'fi-c1.2', title: 'Posting a Simple Journal Entry', content: "A basic financial transaction involving a debit and a credit to General Ledger accounts. T-code: FB50." },
                ]
            },
            { 
                id: 'fi-2', 
                name: 'Accounts Payable (AP) Process',
                chapters: [
                    { id: 'fi-c2.1', title: 'Posting a Vendor Invoice (FI)', content: "Directly posting an invoice without reference to MM. T-code: FB60." },
                    { id: 'fi-c2.2', title: 'Automatic Payment Program (APP)', content: "APP automates the process of selecting due invoices and making payments. T-code: F110." },
                ]
            },
            { 
                id: 'fi-3', 
                name: 'Accounts Receivable (AR) Process',
                chapters: [
                    { id: 'fi-c3.1', title: 'Posting a Customer Invoice (FI)', content: "Directly posting an invoice to a customer. T-code: FB70." },
                    { id: 'fi-c3.2', title: 'Processing Incoming Payments', content: "Recording payments received from customers. T-code: F-28." },
                ]
            },
            { 
                id: 'co-4', 
                name: 'Cost Center Accounting (CCA)',
                chapters: [
                    { id: 'co-c4.1', title: 'Defining Cost Centers and Hierarchy', content: "Cost Centers collect costs where they occur within an organization. T-code: KS01." },
                    { id: 'co-c4.2', title: 'Allocations: Distribution and Assessment', content: "Methods to re-distribute costs from a sender to multiple receiver cost objects." },
                ]
            },
            { 
                id: 'co-5', 
                name: 'Profit Center Accounting (PCA)',
                chapters: [
                    { id: 'co-c5.1', title: 'Setting up a Profit Center', content: "Profit Centers are used for internal control to determine profitability across different areas of the business. T-code: KE51." },
                    { id: 'co-c5.2', title: 'Reporting on Profitability', content: "Analyzing P&L statements segmented by Profit Center." },
                ]
            },
            { 
                id: 'co-6', 
                name: 'Internal Orders and Settlements',
                chapters: [
                    { id: 'co-c6.1', title: 'Using Internal Orders for Tracking', content: "Internal Orders track costs and revenue for specific, short-term projects or events. T-code: KO01." },
                    { id: 'co-c6.2', title: 'Order Settlement Process', content: "Settlement moves the total costs collected on an internal order to a permanent cost object (like a Cost Center or Fixed Asset)." },
                ]
            },
        ]
    },
    {
        id: 'sd',
        title: 'SAP SD (Sales and Distribution)',
        domain: 'Logistics',
        totalModules: 4,
        description: 'Master the Order-to-Cash process including sales order creation, shipping, and billing.',
        modules: [
            { 
                id: 'sd-1', 
                name: 'Sales Order Creation and Types',
                chapters: [
                    { id: 'sd-c1.1', title: 'The Sales Order Document', content: "The core document in SD, containing customer, material, and pricing information. T-code: VA01." },
                    { id: 'sd-c1.2', title: 'Sales Document Types (e.g., OR, RE)', content: "Different document types control the entire sales process flow (Standard Order, Returns, Cash Sale)." },
                ]
            },
            { 
                id: 'sd-2', 
                name: 'Pricing and Condition Techniques',
                chapters: [
                    { id: 'sd-c2.1', title: 'Condition Records and Tables', content: "Pricing in SD is determined by the Condition Technique, which uses condition records to calculate the final price." },
                    { id: 'sd-c2.2', title: 'Pricing Procedure Determination', content: "The procedure is the sequence in which the system calculates prices, discounts, and taxes." },
                ]
            },
            { 
                id: 'sd-3', 
                name: 'Delivery Processing and Picking',
                chapters: [
                    { id: 'sd-c3.1', title: 'Creating the Delivery Document', content: "The delivery document facilitates shipping activities and initiates the stock reduction. T-code: VL01N." },
                    { id: 'sd-c3.2', title: 'Post Goods Issue (PGI)', content: "PGI is the legal movement of goods out of inventory, which triggers a financial posting (COGS) and marks the end of the logistics flow." },
                ]
            },
            { 
                id: 'sd-4', 
                name: 'Billing and Invoicing',
                chapters: [
                    { id: 'sd-c4.1', title: 'Generating the Billing Document', content: "Billing creates the customer invoice and simultaneously posts the revenue and receivable to FI. T-code: VF01." },
                    { id: 'sd-c4.2', title: 'Integration with Financial Accounting', content: "Billing is the key integration point where SD data flows into FI/CO modules." },
                ]
            },
        ]
    },
    {
        id: 'abap',
        title: 'SAP ABAP Fundamentals',
        domain: 'Technical',
        totalModules: 5,
        description: 'Introduction to ABAP programming, data dictionary, reports, and function modules.',
        modules: [
            {
                id: 'abap-1',
                name: 'ABAP Workbench and Syntax Basics',
                chapters: [
                    { id: 'abap-c1.1', title: 'Using the ABAP Editor (SE38/SE80)', content: "The primary tool for writing and managing ABAP code. T-code: SE38." },
                    { id: 'abap-c1.2', title: 'Basic Data Types and Variables', content: "Understanding C (Character), I (Integer), P (Packed), and other fundamental data types." },
                ]
            },
            {
                id: 'abap-2',
                name: 'SAP Data Dictionary',
                chapters: [
                    { id: 'abap-c2.1', title: 'Creating Transparent Tables', content: "Defining the structure of data tables that map directly to the database. T-code: SE11." },
                    { id: 'abap-c2.2', title: 'Domain and Data Elements', content: "Re-usable components that define technical attributes (Domain) and functional meaning (Data Element) of a field." },
                ]
            },
            {
                id: 'abap-3',
                name: 'Internal Tables and Data Handling',
                chapters: [
                    { id: 'abap-c3.1', title: 'Declaring and Populating Internal Tables', content: "Internal tables are used for processing data within an ABAP program." },
                    { id: 'abap-c3.2', title: 'SELECT Statements (Open SQL)', content: "How to read data from database tables using standard SQL commands in ABAP." },
                ]
            },
            {
                id: 'abap-4',
                name: 'Classical and ALV Reporting',
                chapters: [
                    { id: 'abap-c4.1', title: 'Creating Simple Reports', content: "Basic report programming using WRITE statements." },
                    { id: 'abap-c4.2', title: 'Introduction to ALV Grid Display', content: "Using the ABAP List Viewer (ALV) for professional, interactive data reporting." },
                ]
            },
            {
                id: 'abap-5',
                name: 'Modularization Techniques',
                chapters: [
                    { id: 'abap-c5.1', title: 'Using Includes and Subroutines', content: "Techniques for structuring code for reusability and clarity." },
                    { id: 'abap-c5.2', title: 'Function Modules (SE37)', content: "Reusable global functions stored in the Function Library. T-code: SE37." },
                ]
            }
        ]
    }
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

    // Update function for components: moduleId is now a Chapter ID
    const updateProgress = useCallback((courseId: string, chapterId: string, isCompleted: boolean) => {
        setProgress(prevProgress => {
            let newProgress = [...prevProgress];
            let courseIndex = newProgress.findIndex(p => p.courseId === courseId);

            if (courseIndex === -1) {
                // Course not tracked yet, create new entry
                const newEntry: ProgressEntry = { 
                    courseId, 
                    completedModules: isCompleted ? [chapterId] : [] // Store chapter ID
                };
                newProgress.push(newEntry);
            } else {
                // Course exists, update chapters
                let currentEntry = newProgress[courseIndex];
                let newCompletedModules = [...currentEntry.completedModules];

                if (isCompleted && !newCompletedModules.includes(chapterId)) {
                    newCompletedModules.push(chapterId);
                } else if (!isCompleted) {
                    newCompletedModules = newCompletedModules.filter(id => id !== chapterId);
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

// Utility function to get total chapters for a course
const getTotalChapters = (course: SAPCourse): number => {
    return course.modules.reduce((total, module) => total + module.chapters.length, 0);
};

interface CourseCardProps {
    course: SAPCourse;
    progress?: ProgressEntry;
    onView: (id: string) => void;
}

const CourseCard: React.FC<CourseCardProps> = ({ course, progress, onView }) => {
    const totalChapters = getTotalChapters(course);
    const completedCount = progress?.completedModules.length || 0;
    const completionRatio = totalChapters > 0 ? (completedCount / totalChapters) * 100 : 0;
    const isCompleted = completedCount === totalChapters && totalChapters > 0;

    let domainColor = 'bg-green-500';
    if (course.domain === 'Finance') domainColor = 'bg-yellow-500';
    if (course.domain === 'Technical') domainColor = 'bg-red-500';
    if (course.domain === 'Cross-Functional') domainColor = 'bg-indigo-500';

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
                        {isCompleted ? 'Completed' : `${completedCount}/${totalChapters} Chapters`}
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
    // The update function now takes chapterId
    updateProgress: (courseId: string, chapterId: string, isCompleted: boolean) => void; 
    onBack: () => void;
}

const CourseDetail: React.FC<CourseDetailProps> = ({ course, progress, updateProgress, onBack }) => {
    // Check completion status based on Chapter ID
    const isChapterCompleted = (chapterId: string) => 
        progress?.completedModules.includes(chapterId) || false;

    // Toggle completion, passing Chapter ID
    const handleToggleCompletion = (chapterId: string, isCompleted: boolean) => {
        updateProgress(course.id, chapterId, isCompleted);
    };

    // Calculate progress based on Chapters
    const totalChapters = useMemo(() => getTotalChapters(course), [course]);
    const completedCount = progress?.completedModules.length || 0;
    const completionRatio = totalChapters > 0 ? (completedCount / totalChapters) * 100 : 0;
    const isCourseCompleted = completedCount === totalChapters && totalChapters > 0;
    
    // Total count of Modules that have ALL their chapters completed
    const completedModulesCount = useMemo(() => {
        return course.modules.filter(module => {
            const moduleChapterIds = module.chapters.map(c => c.id);
            return moduleChapterIds.every(chapterId => isChapterCompleted(chapterId));
        }).length;
    }, [course.modules, progress]);


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

            {/* Progress Bar - Updated to show Chapter progress */}
            <div className="mb-6 bg-gray-50 p-4 rounded-lg">
                <div className="flex justify-between items-center mb-2">
                    <span className="font-semibold text-gray-700">
                        Your Progress: {completedCount}/{totalChapters} Chapters Completed
                    </span>
                    <span className="font-bold text-lg" style={{ color: SAP_BLUE }}>{completionRatio.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                    <div 
                        className="h-3 rounded-full transition-all duration-500" 
                        style={{ width: `${completionRatio}%`, backgroundColor: SAP_BLUE }}
                    ></div>
                </div>
            </div>

            {/* Modules List with nested Chapters */}
            <h3 className="text-2xl font-bold text-gray-800 mb-4">Course Modules ({completedModulesCount}/{course.totalModules} Completed)</h3>
            <div className="space-y-6">
                {course.modules.map((module, moduleIndex) => {
                    const moduleTotalChapters = module.chapters.length;
                    const moduleCompletedChapters = module.chapters.filter(c => isChapterCompleted(c.id)).length;
                    const isModuleCompleted = moduleCompletedChapters === moduleTotalChapters;
                    
                    return (
                        <div key={module.id} className="border border-gray-200 rounded-xl shadow-md overflow-hidden">
                            {/* Module Header */}
                            <div className={`p-4 flex justify-between items-center ${isModuleCompleted ? 'bg-green-100' : 'bg-gray-50'}`}>
                                <span className={`text-xl font-bold ${isModuleCompleted ? 'text-green-800' : 'text-gray-800'}`}>
                                    {moduleIndex + 1}. {module.name}
                                </span>
                                <span className={`text-sm font-semibold ${isModuleCompleted ? 'text-green-600' : 'text-gray-500'}`}>
                                    {moduleCompletedChapters}/{moduleTotalChapters} Chapters
                                </span>
                            </div>
                            
                            {/* Chapters List */}
                            <div className="p-2 space-y-1">
                                {module.chapters.map((chapter, chapterIndex) => {
                                    const isCompleted = isChapterCompleted(chapter.id);
                                    return (
                                        <div 
                                            key={chapter.id} 
                                            className={`p-3 rounded-lg flex justify-between items-center transition-all duration-150 border-l-4 ${isCompleted ? 'bg-white border-green-500' : 'bg-gray-100 border-gray-300 hover:bg-gray-200'}`}
                                        >
                                            <span className={`font-medium text-sm flex items-center ${isCompleted ? 'text-green-800' : 'text-gray-700'}`}>
                                                <BookOpen className='w-4 h-4 mr-2 text-indigo-500'/>
                                                {moduleIndex + 1}.{chapterIndex + 1} {chapter.title}
                                            </span>
                                            <button
                                                onClick={() => handleToggleCompletion(chapter.id, !isCompleted)}
                                                className={`px-3 py-1 text-xs font-semibold rounded-full flex items-center transition-all duration-200 ${
                                                    isCompleted 
                                                        ? 'bg-green-500 text-white hover:bg-green-600' 
                                                        : 'bg-white text-[#0083B3] border border-[#0083B3] hover:bg-[#0083B3] hover:text-white'
                                                }`}
                                            >
                                                {isCompleted ? (
                                                    <>
                                                        <CheckCircle className='w-3 h-3 mr-1'/> Completed
                                                    </>
                                                ) : (
                                                    <>
                                                        <Clipboard className='w-3 h-3 mr-1'/> Mark Done
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
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

    const currentChapter = useMemo(() => {
        if (!currentCourse) return null;
        // Simple logic: If an AI lesson starts with the chapter title, 
        // find the matching chapter to use its content as context.
        const chapterTitleMatch = input.match(/learn about (.*)/i);
        if (chapterTitleMatch) {
            const queryTitle = chapterTitleMatch[1].trim().toLowerCase();
            for (const module of currentCourse.modules) {
                for (const chapter of module.chapters) {
                    if (chapter.title.toLowerCase().includes(queryTitle)) {
                        return chapter;
                    }
                }
            }
        }
        return null;
    }, [input, currentCourse]);


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

        const currentInput = input;
        setInput('');
        setResponse('');
        handleStopSpeaking();
        setLoading(true);

        let context = currentCourse 
            ? `The user is currently studying the SAP course: ${currentCourse.title}. `
            : "The user is on the main dashboard. ";

        // New AI Lesson Integration
        if (currentChapter) {
            context += `The user has requested to learn about the chapter: ${currentChapter.title}. Use the following content as your primary source for the answer: "${currentChapter.content}"`;
        } else if (currentCourse) {
            // General course context
            context += `The course domain is ${currentCourse.domain}. Keep your answer relevant to this domain or course if possible.`;
        } else {
            context += "Provide a general SAP answer.";
        }
        
        const systemPrompt = `You are a friendly and knowledgeable SAP AI Instructor. Keep your answers concise, informative, and pedagogical. Your response MUST be in simple Markdown format. ${context}`;
        const userQuery = currentInput;

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
    
    // Example suggestion for the user
    const suggestedAction = useMemo(() => {
        if (currentCourse) {
            const module = currentCourse.modules[0];
            const chapter = module.chapters[0];
            return `Example: "Explain the ${chapter.title} in simple terms."`;
        }
        return `Example: "What is SAP HANA?"`;
    }, [currentCourse]);


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
                <p className="text-gray-800">{response || `Your answers will appear here. ${suggestedAction}`}</p>
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
        if (!course) return false;
        
        const totalChapters = getTotalChapters(course);
        // Check if the progress entry's completed chapters match the total chapters defined
        return totalChapters > 0 && p.completedModules.length === totalChapters;
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
                        <h2>
                            <Link href="/test_page">
                            SAP E-Book
                            </Link>
                        </h2>
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
                         <p className="font-mono text-xs text-gray-700 break-all">{userId}</p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default App;