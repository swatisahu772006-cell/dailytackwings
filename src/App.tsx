import React, { useState, useEffect, useMemo } from 'react';
import { 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  serverTimestamp,
  getDocFromServer
} from 'firebase/firestore';
import { 
  auth, 
  db, 
  signInWithGoogle, 
  logout 
} from './lib/firebase';
import { 
  Habit, 
  DailyEntry, 
  UserProfile 
} from './types';
import { handleFirestoreError } from './lib/errorUtils';
import { ErrorBoundary } from './components/ErrorBoundary';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  Cell,
  Brush
} from 'recharts';
import { 
  LayoutDashboard, 
  Plus, 
  LogOut, 
  LogIn,
  Smile, 
  Zap, 
  CheckCircle2, 
  Circle, 
  Calendar as CalendarIcon,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Trash2,
  TrendingUp,
  Award,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format, startOfToday, addDays, subDays, isSameDay, parseISO } from 'date-fns';
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const PRODUCTIVITY_OPTIONS = [
  { value: 1, label: 'Low', color: 'bg-pink-100 text-pink-600' },
  { value: 2, label: 'Moderate', color: 'bg-pink-200 text-pink-700' },
  { value: 3, label: 'Average', color: 'bg-pink-300 text-pink-800' },
  { value: 4, label: 'High', color: 'bg-pink-400 text-pink-900' },
  { value: 5, label: 'Peak', color: 'bg-pink-600 text-white' },
];

export default function App() {
  return (
    <ErrorBoundary>
      <DailyTackWings />
    </ErrorBoundary>
  );
}

function DailyTackWings() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(startOfToday());
  const [habits, setHabits] = useState<Habit[]>([]);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isGeneratingInsight, setIsGeneratingInsight] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      // Even if no user is logged in, we'll proceed as a "Guest"
      setUser(u || { uid: 'guest-user', displayName: 'Guest User', email: 'guest@example.com' } as User);
      setLoading(false);
      setIsAuthReady(true);
      
      const activeUid = u?.uid || 'guest-user';
      
      // Test connection to Firestore
      const testConnection = async () => {
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          console.error("Firestore connection test:", error);
        }
      };
      testConnection();

      // Ensure user profile exists
      const userRef = doc(db, 'users', activeUid);
      setDoc(userRef, {
        uid: activeUid,
        displayName: u?.displayName || 'Guest User',
        email: u?.email || 'guest@example.com',
        photoURL: u?.photoURL || null,
        createdAt: serverTimestamp()
      }, { merge: true }).catch(err => console.warn("Profile sync skipped (Guest mode)"));
    });
    return unsubscribe;
  }, []);

  const [isAddingHabit, setIsAddingHabit] = useState(false);
  const [newHabitName, setNewHabitName] = useState('');
  const [showGraph, setShowGraph] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [habitToDelete, setHabitToDelete] = useState<string | null>(null);

  // Data Listeners
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const habitsRef = collection(db, 'users', user.uid, 'habits');
    const habitsQuery = query(habitsRef, orderBy('createdAt', 'desc'));
    
    const unsubHabits = onSnapshot(habitsQuery, (snapshot) => {
      const h = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() } as Habit))
        .filter(habit => !habit.deleted);
      setHabits(h);
    }, (err) => handleFirestoreError(err, 'list', `users/${user.uid}/habits`));

    const entriesRef = collection(db, 'users', user.uid, 'entries');
    const unsubEntries = onSnapshot(entriesRef, (snapshot) => {
      const e = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as DailyEntry));
      setEntries(e);
    }, (err) => handleFirestoreError(err, 'list', `users/${user.uid}/entries`));

    return () => {
      unsubHabits();
      unsubEntries();
    };
  }, [user, isAuthReady]);

  const currentEntry = useMemo(() => {
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    return entries.find(e => e.date === dateStr) || {
      id: dateStr,
      uid: user?.uid || '',
      date: dateStr,
      productivity: 3,
      habits: {},
      notes: '',
      isDayCompleted: false,
      createdAt: null
    };
  }, [entries, selectedDate, user]);

  const completionRate = useMemo(() => {
    if (habits.length === 0) return 0;
    const completedCount = Object.values(currentEntry.habits).filter(Boolean).length;
    return Math.round((completedCount / habits.length) * 100);
  }, [currentEntry.habits, habits]);

  const updateEntry = async (updates: Partial<DailyEntry>) => {
    if (!user) return;
    const dateStr = format(selectedDate, 'yyyy-MM-dd');
    const entryRef = doc(db, 'users', user.uid, 'entries', dateStr);
    
    try {
      await setDoc(entryRef, {
        ...currentEntry,
        ...updates,
        uid: user.uid,
        date: dateStr,
        createdAt: currentEntry.createdAt || serverTimestamp()
      }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, 'write', `users/${user.uid}/entries/${dateStr}`);
    }
  };

  const addHabit = async (name: string) => {
    if (!user || !name.trim()) return;
    const habitsRef = collection(db, 'users', user.uid, 'habits');
    const newHabitRef = doc(habitsRef);
    try {
      await setDoc(newHabitRef, {
        uid: user.uid,
        name,
        icon: 'Circle',
        color: 'bg-stone-100',
        createdAt: serverTimestamp()
      });
    } catch (err) {
      handleFirestoreError(err, 'write', `users/${user.uid}/habits`);
    }
  };

  const deleteHabit = async (habitId: string) => {
    if (!user) return;
    const habitRef = doc(db, 'users', user.uid, 'habits', habitId);
    try {
      await setDoc(habitRef, { deleted: true }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, 'write', `users/${user.uid}/habits/${habitId}`);
    }
  };

  const generateInsight = async () => {
    if (!user || entries.length < 3) return;
    setIsGeneratingInsight(true);
    try {
      const recentEntries = entries
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 14)
        .map(e => `Date: ${e.date}, Productivity: ${e.productivity}/5, Habits: ${Object.keys(e.habits).length} done`);

      const prompt = `Based on my recent daily tracking data, provide a brief (2-3 sentences), encouraging, and actionable insight to help me improve my productivity and habit consistency. Keep it minimalist and professional. Data:\n${recentEntries.join('\n')}`;

      const result = await genAI.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt
      });
      setAiInsight(result.text || "Keep up the good work!");
    } catch (error) {
      console.error('Error generating insight:', error);
      setAiInsight("Unable to generate insight at this time. Keep up the good work!");
    } finally {
      setIsGeneratingInsight(false);
    }
  };

  const chartData = useMemo(() => {
    return entries
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
      .map(e => ({
        date: format(parseISO(e.date), 'MMM d'),
        fullDate: e.date,
        productivity: e.productivity,
        completion: habits.length > 0 
          ? Math.round((Object.values(e.habits || {}).filter(Boolean).length / habits.length) * 100)
          : 0
      }));
  }, [entries, habits]);

  const weeklyData = useMemo(() => {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const counts = days.map(day => ({ day, completion: 0, count: 0 }));
    
    entries.forEach(e => {
      const dayIndex = parseISO(e.date).getDay();
      const completion = habits.length > 0 
        ? (Object.values(e.habits || {}).filter(Boolean).length / habits.length) * 100
        : 0;
      counts[dayIndex].completion += completion;
      counts[dayIndex].count += 1;
    });

    return counts.map(c => ({
      day: c.day,
      completion: c.count > 0 ? Math.round(c.completion / c.count) : 0
    }));
  }, [entries, habits]);

  const heatmapData = useMemo(() => {
    const today = startOfToday();
    const data = [];
    for (let i = 60; i >= 0; i--) {
      const date = subDays(today, i);
      const dateStr = format(date, 'yyyy-MM-dd');
      const entry = entries.find(e => e.date === dateStr);
      const completion = entry && habits.length > 0
        ? (Object.values(entry.habits || {}).filter(Boolean).length / habits.length)
        : 0;
      data.push({ date: dateStr, completion });
    }
    return data;
  }, [entries, habits]);

  const thirtyDayAvg = useMemo(() => {
    if (chartData.length === 0) return 0;
    const sum = chartData.reduce((acc, curr) => acc + curr.completion, 0);
    return Math.round(sum / chartData.length);
  }, [chartData]);

  const monthlyWeeklyBreakdown = useMemo(() => {
    const today = startOfToday();
    const weeks = [];
    for (let i = 0; i < 4; i++) {
      const weekEnd = subDays(today, i * 7);
      const weekDates = [...Array(7)].map((_, j) => format(subDays(weekEnd, j), 'yyyy-MM-dd'));
      
      const weekEntries = entries.filter(e => weekDates.includes(e.date));
      const avgCompletion = weekEntries.length > 0
        ? Math.round(weekEntries.reduce((acc, curr) => {
            const completion = habits.length > 0 
              ? (Object.values(curr.habits || {}).filter(Boolean).length / habits.length) * 100
              : 0;
            return acc + completion;
          }, 0) / 7)
        : 0;
      
      weeks.push({
        label: i === 0 ? 'This Week' : i === 1 ? 'Last Week' : `${i + 1}w ago`,
        completion: avgCompletion
      });
    }
    return weeks.reverse();
  }, [entries, habits]);

  const habitStats = useMemo(() => {
    const stats: Record<string, { consistency: number }> = {};
    const today = startOfToday();
    const last30DaysDates = [...Array(30)].map((_, i) => format(subDays(today, i), 'yyyy-MM-dd'));
    
    habits.forEach(h => {
      const completedCount = entries.filter(e => 
        last30DaysDates.includes(e.date) && e.habits[h.id]
      ).length;
      stats[h.id] = {
        consistency: Math.round((completedCount / 30) * 100)
      };
    });
    return stats;
  }, [entries, habits]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 font-sans pb-40">
      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {habitToDelete && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm px-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="glass-card p-8 md:p-12 text-center space-y-8 max-w-sm w-full"
            >
              <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto">
                <Trash2 className="w-10 h-10 text-red-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-bold tracking-tight">Remove Task?</h3>
                <p className="text-slate-500 font-medium">This will permanently delete this habit and all its history.</p>
              </div>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={() => {
                    deleteHabit(habitToDelete);
                    setHabitToDelete(null);
                  }}
                  className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-all"
                >
                  Yes, Delete
                </button>
                <button 
                  onClick={() => setHabitToDelete(null)}
                  className="w-full py-4 bg-slate-50 text-slate-400 rounded-2xl font-bold hover:bg-slate-100 transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Celebration Overlay */}
      <AnimatePresence>
        {showCelebration && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm"
            onClick={() => setShowCelebration(false)}
          >
            <motion.div 
              initial={{ scale: 0.5, y: 50 }}
              animate={{ scale: 1, y: 0 }}
              className="text-center space-y-8 p-12"
            >
              <div className="w-32 h-32 bg-red-500 rounded-full flex items-center justify-center mx-auto shadow-2xl shadow-red-200">
                <Award className="w-16 h-16 text-white" />
              </div>
              <div className="space-y-2">
                <h2 className="text-5xl font-bold tracking-tighter">Day Completed!</h2>
                <p className="text-xl text-slate-500 font-medium">You're making incredible progress.</p>
              </div>
              <button 
                className="px-12 py-5 bg-blue-600 text-white rounded-full font-bold text-lg shadow-xl shadow-blue-200"
                onClick={() => setShowCelebration(false)}
              >
                Continue
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-xl border-b border-slate-100 px-4 md:px-8 py-4 md:py-8 flex items-center justify-between">
        <div className="flex items-center gap-2 md:gap-4">
          <div className="w-10 h-10 md:w-12 md:h-12 bg-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center shadow-xl shadow-blue-200 rotate-3 shrink-0">
            <Zap className="w-6 h-6 md:w-7 md:h-7 text-white" />
          </div>
          <div className="overflow-hidden">
            <h1 className="font-bold tracking-tighter text-xl md:text-3xl text-blue-600 leading-none truncate">dailytackwings</h1>
            <span className="text-[8px] md:text-[10px] font-bold uppercase tracking-[0.2em] md:tracking-[0.3em] text-slate-300 block">Classy Daily Pulse</span>
          </div>
        </div>
        
        <div className="flex items-center gap-3 md:gap-8">
          <button 
            onClick={() => setShowHistory(!showHistory)}
            className={`p-3 rounded-2xl transition-all ${showHistory ? 'bg-blue-50 text-blue-600' : 'hover:bg-blue-50 text-slate-400'}`}
            title="History"
          >
            <History className="w-6 h-6" />
          </button>

          <button 
            onClick={() => setShowGraph(!showGraph)}
            className={`relative p-4 rounded-2xl transition-all group ${showGraph ? 'bg-blue-50' : 'hover:bg-blue-50'}`}
            title="30-Day Analytics"
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <svg className="w-14 h-14 -rotate-90">
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="transparent"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  className="text-slate-100"
                />
                <circle
                  cx="28"
                  cy="28"
                  r="24"
                  fill="transparent"
                  stroke="#2563eb"
                  strokeWidth="2.5"
                  strokeDasharray={2 * Math.PI * 24}
                  strokeDashoffset={2 * Math.PI * 24 * (1 - thirtyDayAvg / 100)}
                  strokeLinecap="round"
                  className="transition-all duration-1000 ease-out"
                />
              </svg>
            </div>
            <div className="relative z-10 flex flex-col items-center">
              <TrendingUp className={`w-6 h-6 transition-colors ${showGraph ? 'text-blue-600' : 'text-slate-400 group-hover:text-blue-600'}`} />
              <span className={`text-[9px] font-black mt-0.5 transition-colors ${showGraph ? 'text-blue-700' : 'text-slate-300 group-hover:text-blue-600'}`}>
                {thirtyDayAvg}%
              </span>
            </div>
          </button>
          
          {user && user.uid !== 'guest-user' ? (
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs font-bold text-slate-900">{user.displayName}</span>
                <button 
                  onClick={logout}
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-red-500 transition-colors"
                >
                  Sign Out
                </button>
              </div>
              <img 
                src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}&background=2563eb&color=fff`} 
                alt="Profile" 
                className="w-10 h-10 rounded-2xl border-2 border-white shadow-lg"
                referrerPolicy="no-referrer"
              />
            </div>
          ) : (
            <button 
              onClick={signInWithGoogle}
              className="flex items-center gap-2 px-4 py-2 md:px-6 md:py-3 bg-blue-600 text-white rounded-2xl font-bold text-sm md:text-base shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
            >
              <LogIn className="w-4 h-4 md:w-5 md:h-5" />
              <span className="hidden sm:inline">Sign In</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 md:px-8 pt-8 md:pt-16 space-y-12 md:space-y-20">
        {/* Guest Call to Action */}
        {user?.uid === 'guest-user' && (
          <section className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-pink-500 to-rose-500 rounded-[2rem] md:rounded-[3rem] blur-2xl opacity-10 group-hover:opacity-20 transition-opacity" />
            <div className="relative bg-white border border-pink-100 p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-xl flex flex-col md:flex-row items-center justify-between gap-8">
              <div className="space-y-4 text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-3 text-pink-500">
                  <Smile className="w-6 h-6" />
                  <span className="small-caps">Cloud Sync</span>
                </div>
                <h3 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900">Sync your habits across devices</h3>
                <p className="text-slate-500 font-medium max-w-md">Sign in with Google to securely save your progress and access your daily pulse from anywhere.</p>
              </div>
              <button 
                onClick={signInWithGoogle}
                className="w-full md:w-auto px-10 py-5 bg-pink-500 text-white rounded-full font-bold text-lg shadow-2xl shadow-pink-100 hover:bg-pink-600 transition-all active:scale-95 flex items-center justify-center gap-4"
              >
                <LogIn className="w-6 h-6" />
                Connect Gmail
              </button>
            </div>
          </section>
        )}

        {/* Date Selector */}
        <section className="flex items-center justify-between glass-card p-4 md:p-8">
          <button 
            onClick={() => setSelectedDate(subDays(selectedDate, 1))}
            className="p-2 md:p-4 hover:bg-blue-50 rounded-2xl md:rounded-3xl transition-all text-slate-300 hover:text-blue-600 group"
          >
            <ChevronLeft className="w-6 h-6 md:w-8 md:h-8 group-active:-translate-x-1 transition-transform" />
          </button>
          
          <div className="flex flex-col items-center">
            <button 
              onClick={() => setSelectedDate(startOfToday())}
              className="small-caps mb-1 md:mb-2 hover:text-blue-600 transition-colors"
            >
              {isSameDay(selectedDate, startOfToday()) ? 'Today' : format(selectedDate, 'EEEE')}
            </button>
            <div className="flex items-center gap-2 md:gap-3">
              <CalendarIcon className="w-4 h-4 md:w-5 md:h-5 text-blue-600" />
              <span className="text-xl md:text-3xl font-bold tracking-tight text-slate-800">
                {format(selectedDate, 'MMMM do')}
              </span>
            </div>
          </div>

          <button 
            onClick={() => setSelectedDate(addDays(selectedDate, 1))}
            className="p-2 md:p-4 hover:bg-blue-50 rounded-2xl md:rounded-3xl transition-all text-slate-300 hover:text-blue-600 group"
          >
            <ChevronRight className="w-6 h-6 md:w-8 md:h-8 group-active:translate-x-1 transition-transform" />
          </button>
        </section>

        {/* History Section */}
        <AnimatePresence>
          {showHistory && (
            <motion.section 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="glass-card p-6 md:p-10 space-y-6 md:space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl md:text-2xl font-bold tracking-tight">Checklist History</h3>
                  <p className="text-xs md:text-sm text-slate-400 font-medium">Jump back to any previous day</p>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="text-xs font-bold uppercase tracking-widest text-blue-600 hover:text-blue-700"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {entries
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((entry) => {
                    const date = parseISO(entry.date);
                    const completion = habits.length > 0 
                      ? Math.round((Object.values(entry.habits || {}).filter(Boolean).length / habits.length) * 100)
                      : 0;
                    const isSelected = isSameDay(selectedDate, date);

                    return (
                      <button
                        key={entry.date}
                        onClick={() => {
                          setSelectedDate(date);
                          setShowHistory(false);
                        }}
                        className={`flex items-center justify-between p-6 rounded-3xl border-2 transition-all ${
                          isSelected 
                            ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-100' 
                            : 'bg-slate-50 border-transparent hover:border-blue-200 text-slate-700'
                        }`}
                      >
                        <div className="flex flex-col items-start">
                          <span className="text-xs font-bold uppercase tracking-widest opacity-60">
                            {format(date, 'EEEE')}
                          </span>
                          <span className="text-lg font-bold tracking-tight">
                            {format(date, 'MMM do, yyyy')}
                          </span>
                        </div>
                        <div className="flex flex-col items-end">
                          <span className={`text-xl font-black ${isSelected ? 'text-white' : 'text-blue-600'}`}>
                            {completion}%
                          </span>
                          <span className="text-[9px] font-bold uppercase tracking-widest opacity-60">Done</span>
                        </div>
                      </button>
                    );
                  })}
                {entries.length === 0 && (
                  <div className="col-span-full py-12 text-center text-slate-400 font-medium">
                    No previous entries found.
                  </div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Analytics Section */}
        <AnimatePresence>
          {showGraph && (
            <motion.section 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card p-6 md:p-10 space-y-8 md:space-y-10"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl md:text-2xl font-bold tracking-tight">Performance Trends</h3>
                  <p className="text-xs md:text-sm text-slate-400 font-medium">Your activity over the last 30 days</p>
                </div>
                <div className="flex flex-col items-start sm:items-end">
                  <span className="stat-value text-blue-600 text-2xl md:text-4xl">
                    {Math.round(chartData.reduce((acc, curr) => acc + curr.completion, 0) / Math.max(1, chartData.length))}%
                  </span>
                  <span className="text-[9px] md:text-[10px] font-bold uppercase tracking-widest text-slate-400">Overall Accuracy</span>
                </div>
              </div>
              
              <div className="flex gap-6">
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-blue-600" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Completion</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-3 h-3 rounded-full bg-pink-500" />
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Productivity</span>
                  </div>
                </div>
              
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorComp" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15}/>
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorProd" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ec4899" stopOpacity={0.1}/>
                        <stop offset="95%" stopColor="#ec4899" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.03)" vertical={false} />
                    <XAxis 
                      dataKey="date" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: 'rgba(0,0,0,0.3)', fontSize: 10, fontWeight: 600 }}
                      dy={15}
                      interval={Math.ceil(chartData.length / 7)}
                    />
                    <YAxis hide domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'rgba(255,255,255,0.9)', 
                        backdropFilter: 'blur(10px)',
                        border: 'none', 
                        borderRadius: '20px', 
                        boxShadow: '0 20px 40px rgba(0,0,0,0.1)',
                        padding: '15px'
                      }}
                      itemStyle={{ fontSize: '12px', fontWeight: 700 }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="completion" 
                      stroke="#2563eb" 
                      fillOpacity={1} 
                      fill="url(#colorComp)" 
                      strokeWidth={4}
                      animationDuration={1500}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="productivity" 
                      stroke="#ec4899" 
                      fillOpacity={1}
                      fill="url(#colorProd)"
                      strokeWidth={4} 
                      strokeDasharray="5 5"
                      animationDuration={2000}
                    />
                    <Brush 
                      dataKey="date" 
                      height={30} 
                      stroke="#2563eb" 
                      fill="#f8fafc"
                      gap={5}
                      travellerWidth={10}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400">Weekly Consistency</h4>
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">By Day</span>
                  </div>
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={weeklyData}>
                        <XAxis 
                          dataKey="day" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{ fill: 'rgba(0,0,0,0.3)', fontSize: 10, fontWeight: 600 }}
                        />
                        <Tooltip 
                          cursor={{ fill: 'rgba(0,0,0,0.02)' }}
                          contentStyle={{ 
                            backgroundColor: 'white', 
                            border: 'none', 
                            borderRadius: '12px', 
                            boxShadow: '0 10px 20px rgba(0,0,0,0.05)' 
                          }}
                        />
                        <Bar dataKey="completion" radius={[4, 4, 0, 0]}>
                          {weeklyData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.completion > 70 ? '#2563eb' : '#94a3b8'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="space-y-8">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400">Monthly Breakdown</h4>
                    <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">By Week</span>
                  </div>
                  <div className="space-y-4">
                    {monthlyWeeklyBreakdown.map((week, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-between text-[11px] font-bold uppercase tracking-widest">
                          <span className="text-slate-400">{week.label}</span>
                          <span className="text-blue-600">{week.completion}%</span>
                        </div>
                        <div className="h-2 bg-slate-50 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${week.completion}%` }}
                            transition={{ duration: 1, delay: i * 0.1 }}
                            className="h-full bg-blue-600 rounded-full"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-6 md:col-span-2">
                  <h4 className="text-sm font-bold uppercase tracking-widest text-slate-400">Activity Heatmap</h4>
                  <div className="grid grid-cols-7 gap-2">
                    {heatmapData.map((d, i) => (
                      <div 
                        key={i}
                        className="aspect-square rounded-sm transition-all hover:scale-125 cursor-help"
                        style={{ 
                          backgroundColor: d.completion > 0 
                            ? `rgba(37, 99, 235, ${Math.max(0.1, d.completion)})` 
                            : '#f8fafc' 
                        }}
                        title={`${d.date}: ${Math.round(d.completion * 100)}%`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest text-slate-300">
                    <span>Less</span>
                    <div className="flex gap-1">
                      {[0.1, 0.3, 0.6, 0.9].map(o => (
                        <div key={o} className="w-2 h-2 rounded-sm" style={{ backgroundColor: `rgba(37, 99, 235, ${o})` }} />
                      ))}
                    </div>
                    <span>More</span>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* AI Insights Card */}
        <AnimatePresence>
          {entries.length >= 3 && (
            <motion.section 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="relative group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-[2rem] md:rounded-[3rem] blur-2xl opacity-20 group-hover:opacity-30 transition-opacity" />
              <div className="relative bg-blue-600 text-white p-6 md:p-12 rounded-[2rem] md:rounded-[3rem] shadow-2xl shadow-blue-200 overflow-hidden">
                <div className="relative z-10 space-y-6 md:space-y-8">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 md:gap-3 text-blue-200">
                      <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
                      <span className="text-[9px] md:text-[11px] font-bold uppercase tracking-[0.2em] md:tracking-[0.3em]">AI Intelligence</span>
                    </div>
                    <div className="w-8 h-8 md:w-10 md:h-10 bg-white/10 rounded-full flex items-center justify-center">
                      <div className="w-1.5 h-1.5 md:w-2 md:h-2 bg-white rounded-full animate-ping" />
                    </div>
                  </div>
                  
                  {aiInsight ? (
                    <motion.p 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-2xl md:text-4xl font-bold leading-tight tracking-tight"
                    >
                      "{aiInsight}"
                    </motion.p>
                  ) : (
                    <div className="space-y-6 md:space-y-8">
                      <p className="text-blue-100 text-lg md:text-2xl font-medium leading-relaxed">Your data holds the key to your next breakthrough. Let's unlock it.</p>
                      <button 
                        onClick={generateInsight}
                        disabled={isGeneratingInsight}
                        className="w-full sm:w-auto px-6 md:px-10 py-4 md:py-5 bg-white text-blue-600 rounded-full text-sm md:text-base font-bold hover:bg-blue-50 transition-all flex items-center justify-center gap-3 md:gap-4 shadow-xl active:scale-95"
                      >
                        {isGeneratingInsight ? <Loader2 className="w-5 h-5 md:w-6 md:h-6 animate-spin" /> : <Sparkles className="w-5 h-5 md:w-6 md:h-6" />}
                        Generate Intelligence
                      </button>
                    </div>
                  )}
                </div>
                {/* Decorative elements */}
                <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
                <div className="absolute -left-10 -top-10 w-40 h-40 bg-blue-400/20 rounded-full blur-2xl" />
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Productivity */}
        <section className="space-y-6 md:space-y-10">
          <div className="glass-card p-6 md:p-10 space-y-6 md:space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 md:gap-3">
                <div className="w-7 h-7 md:w-8 md:h-8 bg-pink-50 rounded-lg md:rounded-xl flex items-center justify-center">
                  <Zap className="w-4 h-4 md:w-5 md:h-5 text-pink-600" />
                </div>
                <span className="small-caps">Productivity</span>
              </div>
              <span className="text-[10px] md:text-xs font-bold text-slate-300">Scale 1-5</span>
            </div>
            <div className="flex justify-between gap-2 md:gap-3">
              {PRODUCTIVITY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateEntry({ productivity: opt.value })}
                  className={`flex-1 py-4 md:py-6 rounded-2xl md:rounded-3xl transition-all font-bold text-lg md:text-xl ${
                    currentEntry.productivity === opt.value 
                      ? opt.color + ' scale-105 md:scale-110 shadow-xl ring-2 md:ring-4 ring-white' 
                      : 'bg-slate-50 text-slate-300 hover:bg-slate-100'
                  }`}
                >
                  {opt.value}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Habits */}
        <section className="space-y-6 md:space-y-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              <div className="w-8 h-8 md:w-10 md:h-10 bg-blue-600 rounded-xl md:rounded-2xl flex items-center justify-center shadow-lg shadow-blue-100">
                <CheckCircle2 className="w-5 h-5 md:w-6 md:h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl md:text-2xl font-bold tracking-tight">Daily Habits</h2>
                <p className="text-xs md:text-sm text-slate-400 font-medium">{habits.length} tasks defined</p>
              </div>
            </div>
            <button 
              onClick={() => setIsAddingHabit(!isAddingHabit)}
              className={`p-3 md:p-4 rounded-xl md:rounded-2xl transition-all ${isAddingHabit ? 'bg-pink-500 text-white shadow-xl shadow-pink-200' : 'bg-slate-50 text-slate-400 hover:bg-slate-100'}`}
            >
              <Plus className={`w-6 h-6 md:w-7 md:h-7 transition-transform duration-500 ${isAddingHabit ? 'rotate-45' : ''}`} />
            </button>
          </div>

          <AnimatePresence>
            {isAddingHabit && (
              <motion.div 
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <form 
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (newHabitName.trim()) {
                      addHabit(newHabitName);
                      setNewHabitName('');
                      setIsAddingHabit(false);
                    }
                  }}
                  className="flex flex-col sm:flex-row gap-3 md:gap-4 mb-8 md:mb-10"
                >
                  <input 
                    autoFocus
                    type="text"
                    value={newHabitName}
                    onChange={(e) => setNewHabitName(e.target.value)}
                    placeholder="What's your next goal?"
                    className="flex-1 px-6 md:px-8 py-4 md:py-5 bg-white rounded-2xl md:rounded-3xl border border-slate-100 focus:border-blue-400 outline-none transition-all text-lg md:text-xl font-medium shadow-inner"
                  />
                  <button 
                    type="submit"
                    className="px-8 md:px-10 py-4 md:py-5 bg-blue-600 text-white rounded-2xl md:rounded-3xl font-bold text-base md:text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 active:scale-95"
                  >
                    Add Task
                  </button>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 gap-6">
            {habits.length === 0 ? (
              <div className="text-center py-24 glass-card border-dashed border-2 border-slate-100">
                <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <LayoutDashboard className="w-10 h-10 text-slate-200" />
                </div>
                <p className="text-slate-400 font-bold tracking-tight text-xl">Your journey starts here.</p>
                <p className="text-slate-300 text-sm mt-2">Add your first habit to begin tracking.</p>
              </div>
            ) : (
              habits.map((habit) => {
                const isCompleted = currentEntry.habits[habit.id] || false;
                return (
                  <motion.div 
                    key={habit.id} 
                    layout
                    className="group relative flex items-center gap-6"
                  >
                    <motion.button
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        const newHabits = { ...currentEntry.habits };
                        newHabits[habit.id] = !isCompleted;
                        updateEntry({ habits: newHabits });
                      }}
                      className={`flex-1 flex items-center justify-between p-6 md:p-10 rounded-[1.5rem] md:rounded-[2.5rem] border-2 transition-all duration-500 ${
                        isCompleted 
                          ? 'bg-blue-600 border-blue-600 text-white shadow-2xl shadow-blue-200' 
                          : 'bg-white border-slate-50 text-slate-700 hover:border-blue-100 hover:bg-blue-50/20'
                      }`}
                    >
                      <div className="flex items-center gap-4 md:gap-6">
                        <div className={`w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl flex items-center justify-center transition-colors ${isCompleted ? 'bg-white/20' : 'bg-slate-50'}`}>
                          {isCompleted ? <CheckCircle2 className="w-6 h-6 md:w-8 md:h-8" /> : <Circle className="w-6 h-6 md:w-8 md:h-8 text-slate-200" />}
                        </div>
                        <div>
                          <span className="text-lg md:text-2xl font-bold tracking-tight block">{habit.name}</span>
                          <span className={`text-[9px] md:text-[10px] font-bold uppercase tracking-widest ${isCompleted ? 'text-white/60' : 'text-slate-400'}`}>
                            {habitStats[habit.id]?.consistency}% Accuracy
                          </span>
                        </div>
                      </div>
                      
                      {/* Mini History Sparkline */}
                      <div className="hidden sm:flex items-center gap-1.5 h-8 items-end">
                        {[...Array(7)].map((_, i) => {
                          const date = subDays(startOfToday(), 6 - i);
                          const dateStr = format(date, 'yyyy-MM-dd');
                          const entry = entries.find(e => e.date === dateStr);
                          const done = entry?.habits[habit.id];
                          return (
                            <div 
                              key={i} 
                              className={`w-2 rounded-full transition-all duration-500 ${
                                done 
                                  ? (isCompleted ? 'bg-white h-6' : 'bg-blue-600 h-6') 
                                  : (isCompleted ? 'bg-white/20 h-2' : 'bg-slate-100 h-2')
                              }`}
                              title={format(date, 'MMM d')}
                            />
                          );
                        })}
                      </div>
                    </motion.button>
                    
                    <button
                      onClick={() => setHabitToDelete(habit.id)}
                      className="opacity-0 group-hover:opacity-100 p-3 md:p-5 text-slate-200 hover:text-red-500 transition-all hover:scale-110"
                    >
                      <Trash2 className="w-6 h-6 md:w-7 md:h-7" />
                    </button>
                  </motion.div>
                );
              })
            )}
          </div>
        </section>

        {/* Notes */}
        <section className="space-y-6 md:space-y-8">
          <div className="flex items-center gap-3 md:gap-4">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-pink-50 rounded-xl flex items-center justify-center">
              <CalendarIcon className="w-5 h-5 md:w-6 md:h-6 text-pink-500" />
            </div>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight">Daily Reflection</h2>
          </div>
          <textarea
            value={currentEntry.notes}
            onChange={(e) => updateEntry({ notes: e.target.value })}
            placeholder="Write your thoughts here..."
            className="w-full h-48 md:h-64 p-6 md:p-10 bg-white rounded-[2rem] md:rounded-[3rem] border-2 border-slate-50 focus:border-blue-400 outline-none transition-all resize-none text-lg md:text-xl font-medium leading-relaxed shadow-inner placeholder:text-slate-200"
          />
        </section>

        {/* Done for the Day */}
        <section className="pt-8 md:pt-12 pb-20">
          <motion.button 
            whileHover={!currentEntry.isDayCompleted ? { scale: 1.02, y: -5 } : {}}
            whileTap={!currentEntry.isDayCompleted ? { scale: 0.98 } : {}}
            onClick={() => {
              if (currentEntry.isDayCompleted) return;
              updateEntry({ 
                isDayCompleted: true,
                notes: currentEntry.notes + (currentEntry.notes.includes('[Day Completed]') ? '' : '\n\n[Day Completed]') 
              });
              setShowCelebration(true);
            }}
            disabled={currentEntry.isDayCompleted}
            className={`w-full py-8 md:py-12 rounded-[2.5rem] md:rounded-[4rem] font-bold text-xl md:text-3xl transition-all flex items-center justify-center gap-4 md:gap-6 shadow-2xl group relative overflow-hidden ${
              currentEntry.isDayCompleted 
                ? 'bg-emerald-500 text-white cursor-default' 
                : 'bg-red-500 text-white hover:bg-red-600 hover:shadow-3xl hover:shadow-red-200'
            }`}
          >
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000" />
            <Award className={`w-8 h-8 md:w-12 md:h-12 ${!currentEntry.isDayCompleted ? 'group-hover:rotate-12' : ''} transition-transform`} />
            {currentEntry.isDayCompleted ? 'Day Completed' : 'Done for the Day'}
          </motion.button>
        </section>
      </main>

      {/* Bottom Navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white/90 backdrop-blur-2xl border-t border-slate-100 px-4 md:px-10 py-4 md:py-10 z-40">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-12">
            <div className="flex flex-col">
              <span className="small-caps mb-1 md:mb-2">Daily Progress</span>
              <div className="flex items-baseline gap-1 md:gap-2">
                <span className="stat-value text-blue-600 text-xl md:text-4xl">{completionRate}%</span>
                <span className="text-[9px] md:text-xs font-bold text-slate-300 uppercase tracking-widest">Complete</span>
              </div>
            </div>
            <div className="h-8 md:h-12 w-[1px] md:w-[2px] bg-slate-100" />
            <div className="flex flex-col">
              <span className="small-caps mb-1 md:mb-2">Daily Status</span>
              <span className={`text-sm md:text-xl font-bold tracking-tight ${currentEntry.isDayCompleted ? 'text-emerald-500' : 'text-slate-400'}`}>
                {currentEntry.isDayCompleted ? 'Day Completed' : 'In Progress'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-3 md:gap-6">
            <div className="relative">
              <div className={`w-4 h-4 md:w-6 md:h-6 rounded-full transition-all duration-700 ${currentEntry.isDayCompleted ? 'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.5)]' : 'bg-slate-100'}`} />
              {currentEntry.isDayCompleted && (
                <motion.div 
                  initial={{ scale: 0 }}
                  animate={{ scale: 1.5, opacity: 0 }}
                  transition={{ repeat: Infinity, duration: 2 }}
                  className="absolute inset-0 bg-emerald-500 rounded-full"
                />
              )}
            </div>
          </div>
        </div>
      </nav>
    </div>
  );
}
