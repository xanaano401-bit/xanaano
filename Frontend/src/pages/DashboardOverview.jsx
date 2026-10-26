import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Activity, AlertCircle, AlertTriangle, ArrowRight, ArrowRightLeft, BookOpen,
    DollarSign, Plus, ShieldCheck, UserCheck, Users, Wallet, CalendarCheck, CreditCard, Receipt,
    RefreshCw, X, ExternalLink, Sparkles, Filter, CheckCircle2, History,
    Calendar, ChevronLeft, ChevronRight, RotateCcw, CalendarClock
} from 'lucide-react';
import KPICard from './KPICard';
import api, { clearApiCache } from '../services/api';
import {
    currentCycle,
    previousCycle,
    cycleLabel,
    cycleShortLabel,
    addCycles,
    cycleRange,
    cycleKeyForDate
} from '../utils/billingCycle';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import { translateApiMessage } from '../i18n/core.js';
import { NAV_CONFIG } from '../constants.jsx';
import { hasNavPermission } from '../utils/permissionUtils';

const DashboardOverview = () => {
    const navigate = useNavigate();
    const { t, tv, locale, months } = useLanguage();
    const [currentUser] = useState(() => {
        try {
            const u = sessionStorage.getItem('userInfo');
            return u ? JSON.parse(u) : null;
        } catch {
            return null;
        }
    });
    const currentRole = currentUser?.role || currentUser?.roles?.[0]?.name?.toUpperCase().replace(/ /g, '_');

    const hasFinancePerm = hasNavPermission(currentUser, currentRole, 'Finance', null, NAV_CONFIG);
    const hasAcademicPerm = hasNavPermission(currentUser, currentRole, 'Academic Management', null, NAV_CONFIG);
    const hasAttendancePerm = hasNavPermission(currentUser, currentRole, 'Attendance', null, NAV_CONFIG);

    // Active Billing Cycle: loads from sessionStorage or defaults to currentCycle()
    const [selectedCycle, setSelectedCycle] = useState(() => {
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const fromUrl = urlParams.get('cycle') || urlParams.get('month');
            const saved = sessionStorage.getItem('active_billing_cycle');
            return fromUrl || saved || currentCycle();
        } catch {
            return currentCycle();
        }
    });

    const [dashboardData, setDashboardData] = useState(() => {
        try {
            const cached = sessionStorage.getItem(`cachedDashboardData_${selectedCycle}`);
            return cached ? JSON.parse(cached) : {
                kpis: {},
                activities: [],
                notifications: [],
                alerts: { lowStock: [], expiry: [], delayed: [] }
            };
        } catch {
            return {
                kpis: {},
                activities: [],
                notifications: [],
                alerts: { lowStock: [], expiry: [], delayed: [] }
            };
        }
    });

    const [loading, setLoading] = useState(() => {
        return !sessionStorage.getItem(`cachedDashboardData_${selectedCycle}`);
    });
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [activeCategory, setActiveCategory] = useState('all');
    const [selectedCardForModal, setSelectedCardForModal] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(() => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

    // Generate recent billing cycle options for picker
    const cycleOptions = useMemo(() => {
        const cur = currentCycle();
        const list = [];
        for (let i = 1; i >= -12; i--) {
            const key = addCycles(cur, i);
            list.push({
                key,
                label: `${key} · ${cycleShortLabel(key)}`,
                isCurrent: key === cur
            });
        }
        return list;
    }, []);

    const fetchDashboardData = async (fresh = false, targetCycle = selectedCycle) => {
        try {
            if (fresh) {
                setIsRefreshing(true);
                clearApiCache();
                sessionStorage.removeItem(`cachedDashboardData_${targetCycle}`);
            }
            const { data } = await api.get('/dashboard', {
                params: { cycle: targetCycle },
                skipCache: fresh
            });
            if (data) {
                setDashboardData(data);
                sessionStorage.setItem(`cachedDashboardData_${targetCycle}`, JSON.stringify(data));
                sessionStorage.setItem('active_billing_cycle', targetCycle);
                setLastUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
            }
        } catch (error) {
            console.error('Failed to fetch dashboard data', error);
        } finally {
            setLoading(false);
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        fetchDashboardData(false, selectedCycle);
    }, [selectedCycle]);

    const handleCycleChange = (newCycle) => {
        setSelectedCycle(newCycle);
        sessionStorage.setItem('active_billing_cycle', newCycle);
    };

    if (loading) {
        return (
            <div className="flex h-[calc(100vh-100px)] flex-col items-center justify-center">
                <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
                <span className="text-xs font-black uppercase tracking-widest text-slate-400">{t('dashboard.loading')}</span>
            </div>
        );
    }

    const { kpis = {}, activities = [], notifications = [] } = dashboardData;
    const today = new Date();
    const cycle = selectedCycle;
    const isCurrentActiveCycle = selectedCycle === currentCycle();
    const billingCycleName = cycleLabel(cycle);
    const previousCycleName = cycleLabel(previousCycle(cycle));
    const prevCycleKey = previousCycle(cycle);
    const balance = (kpis.totalIncome || 0) - (kpis.totalExpenses || 0);
    const fmtSignedMoney = (n) => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString()}`;

    const money = (n) => `$${(n || 0).toLocaleString()}`;
    const totalStudentCollected = (kpis.totalStudentFeesCollected != null)
        ? kpis.totalStudentFeesCollected
        : ((kpis.studentFeesCollected || 0) + (kpis.debtFeesCollected || 0) + (kpis.advanceFeesCollected || 0));
    const otherIncome = Math.max(0, (kpis.totalIncome || 0) - totalStudentCollected);
    const otherExpenses = Math.max(0, (kpis.totalExpenses || 0) - (kpis.totalSalaries || 0));
    // Card texts live under dashboard.cards.<textKey>.* in the locale files.
    const cardText = (textKey, field, vars) => t(`dashboard.cards.${textKey}.${field}`, vars);

    const quickActions = [
        { key: 'addStudent', icon: Plus, path: '/academic/students', allowed: hasAcademicPerm },
        { key: 'studentAttendance', icon: CalendarCheck, path: '/attendance/students', allowed: hasAttendancePerm },
        { key: 'recordPayment', icon: Receipt, path: `/finance/monthly-payments?month=${cycle}`, allowed: hasFinancePerm },
        { key: 'createClass', icon: BookOpen, path: '/academic/classes', allowed: hasAcademicPerm },
    ].filter(a => a.allowed).map((action) => ({
        ...action,
        title: t(`dashboard.quickActions.${action.key}.title`),
        subtitle: t(`dashboard.quickActions.${action.key}.subtitle`)
    }));

    const cardsConfig = [
        {
            id: 'total-students',
            textKey: 'totalStudents',
            category: 'academic',
            value: (kpis.totalStudents || 0).toLocaleString(),
            rawValue: kpis.totalStudents || 0,
            icon: <Users size={20} />,
            color: 'bg-emerald-500',
            badgeColor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
            path: '/academic/students',
            description: `${cycle} • ${billingCycleName}`,
            statValue: (kpis.newStudentsInCycle && kpis.newStudentsInCycle > 0)
                ? `+${kpis.newStudentsInCycle} ${locale === 'so' ? 'cusub' : 'new'}`
                : cardText('totalStudents', 'statValue', { count: kpis.totalClasses || 0 })
        },
        {
            id: 'total-teachers',
            textKey: 'totalTeachers',
            category: 'academic',
            value: (kpis.totalTeachers || 0).toLocaleString(),
            rawValue: kpis.totalTeachers || 0,
            icon: <UserCheck size={20} />,
            color: 'bg-violet-600',
            badgeColor: 'bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300',
            path: `/academic/teachers?cycle=${cycle}`,
            description: `${cycle} • ${billingCycleName}`,
            statValue: (kpis.newTeachersInCycle && kpis.newTeachersInCycle > 0)
                ? `+${kpis.newTeachersInCycle} ${locale === 'so' ? 'cusub' : 'new'}`
                : cardText('totalTeachers', 'statValue', { count: kpis.todayTeacherAttendance || 0 })
        },
        {
            id: 'total-classes',
            textKey: 'totalClasses',
            category: 'academic',
            value: (kpis.totalClasses || 0).toLocaleString(),
            rawValue: kpis.totalClasses || 0,
            icon: <BookOpen size={20} />,
            color: 'bg-blue-600',
            badgeColor: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
            path: '/academic/classes',
            description: `${cycle} • ${billingCycleName}`,
            statValue: kpis.totalClasses ? Math.round((kpis.totalStudents || 0) / kpis.totalClasses) : 0
        },
        {
            id: 'total-guardians',
            textKey: 'totalGuardians',
            category: 'academic',
            value: (kpis.totalGuardians || 0).toLocaleString(),
            rawValue: kpis.totalGuardians || 0,
            icon: <Users size={20} />,
            color: 'bg-amber-500',
            badgeColor: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
            path: '/academic/guardians',
            description: `${cycle} • ${billingCycleName}`,
            statValue: cardText('totalGuardians', 'statValue', { count: kpis.totalGuardians || 0 })
        },
        {
            id: 'total-fees-due',
            textKey: 'totalFeesDue',
            category: 'finance',
            value: money(kpis.expectedStudentFees),
            rawValue: kpis.expectedStudentFees || 0,
            icon: <DollarSign size={20} />,
            color: 'bg-blue-600',
            badgeColor: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
            path: `/finance/monthly-payments?month=${cycle}`,
            description: `${cycle} · ${billingCycleName}`,
            explanationVars: { cycle: `${cycle} (${billingCycleName})` },
            statValue: `${money(kpis.studentFeesCollected)} / ${money(kpis.pendingStudentFees)}`
        },
        {
            id: 'fees-collected',
            textKey: 'feesCollected',
            category: 'finance',
            value: money(kpis.studentFeesCollected),
            rawValue: kpis.studentFeesCollected || 0,
            icon: <Receipt size={20} />,
            color: 'bg-teal-500',
            badgeColor: 'bg-teal-50 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
            path: `/finance/monthly-payments?month=${cycle}&status=paid`,
            description: `${cycle} · ${billingCycleName}`,
            explanationVars: { cycle: `${cycle} (${billingCycleName})` },
            statValue: money(kpis.expectedStudentFees),
            progress: kpis.expectedStudentFees ? ((kpis.studentFeesCollected || 0) / kpis.expectedStudentFees) * 100 : undefined
        },
        {
            id: 'pending-fees',
            textKey: 'pendingFees',
            category: 'finance',
            value: money(kpis.pendingStudentFees),
            rawValue: kpis.pendingStudentFees || 0,
            icon: <CreditCard size={20} />,
            color: 'bg-purple-600',
            badgeColor: 'bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300',
            path: `/finance/monthly-payments?month=${cycle}&status=pending`,
            description: `${cycle} · ${billingCycleName}`,
            statValue: money(kpis.expectedStudentFees)
        },
        {
            id: 'debt-fees-collected',
            textKey: 'debtFeesCollected',
            category: 'finance',
            value: money(kpis.debtFeesCollected),
            rawValue: kpis.debtFeesCollected || 0,
            icon: <RotateCcw size={20} />,
            color: 'bg-amber-600',
            badgeColor: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
            path: `/finance/monthly-payments?view=previousDebt&month=previous`,
            description: `${cycle} · ${billingCycleName}`,
            explanationVars: { cycle: `${cycle} (${billingCycleName})` },
            statValue: money(kpis.previousDebt)
        },
        {
            id: 'advance-fees-collected',
            textKey: 'advanceFeesCollected',
            category: 'finance',
            value: money(kpis.advanceFeesCollected),
            rawValue: kpis.advanceFeesCollected || 0,
            icon: <CalendarClock size={20} />,
            color: 'bg-indigo-600',
            badgeColor: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
            path: `/finance/cashbook?month=${cycle}`,
            description: `${cycle} · ${billingCycleName}`,
            explanationVars: { cycle: `${cycle} (${billingCycleName})` },
            statValue: money(kpis.advanceFeesCollected)
        },
        {
            id: 'total-income',
            textKey: 'totalIncome',
            category: 'finance',
            value: money(kpis.totalIncome),
            rawValue: kpis.totalIncome || 0,
            icon: <DollarSign size={20} />,
            color: 'bg-emerald-600',
            badgeColor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
            path: `/finance/cashbook?month=${cycle}`,
            description: `${cycle} · ${billingCycleName}`,
            explanationVars: { cycle: `${cycle} (${billingCycleName})`, fees: money(totalStudentCollected), other: money(otherIncome) },
            statValue: money(otherIncome)
        },
        {
            id: 'total-expenses',
            textKey: 'totalExpenses',
            category: 'finance',
            value: money(kpis.totalExpenses),
            rawValue: kpis.totalExpenses || 0,
            icon: <ArrowRightLeft size={20} />,
            color: 'bg-rose-500',
            badgeColor: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300',
            path: `/finance/cashbook?month=${cycle}`,
            description: `${cycle} · ${billingCycleName}`,
            explanationVars: { cycle: `${cycle} (${billingCycleName})`, salaries: money(kpis.totalSalaries), other: money(otherExpenses) },
            statValue: money(otherExpenses)
        },
        {
            id: 'balance',
            textKey: 'balance',
            category: 'finance',
            value: fmtSignedMoney(balance),
            rawValue: balance,
            icon: <Wallet size={20} />,
            color: balance < 0 ? 'bg-rose-600' : 'bg-emerald-700',
            badge: balance < 0 ? t('dashboard.cards.balance.badgeDeficit') : t('dashboard.cards.balance.badge'),
            badgeColor: balance < 0
                ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300'
                : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
            path: `/finance/cashbook?month=${cycle}`,
            description: `${cycle} · ${billingCycleName}`,
            explanationVars: { cycle: `${cycle} (${billingCycleName})`, income: money(kpis.totalIncome), expenses: money(kpis.totalExpenses) },
            statValue: `${money(kpis.totalIncome)} / ${money(kpis.totalExpenses)}`
        },
        {
            id: 'previous-debt',
            textKey: 'previousDebt',
            category: 'finance',
            value: money(kpis.previousDebt),
            rawValue: kpis.previousDebt || 0,
            icon: <AlertCircle size={20} />,
            color: 'bg-red-600',
            badgeColor: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300',
            path: `/finance/monthly-payments?view=previousDebt&month=previous`,
            description: cardText('previousDebt', 'description', { cycle: `${cycle} (${billingCycleName})` }),
            explanationVars: { cycle: `${cycle} (${billingCycleName})` },
            statValue: previousCycleName
        },
        {
            id: 'historical-cycle-debt',
            textKey: 'historicalCycleDebt',
            category: 'finance',
            value: money(kpis.historicalCycleDebt),
            rawValue: kpis.historicalCycleDebt || 0,
            icon: <History size={20} />,
            color: 'bg-amber-600',
            badgeColor: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
            path: `/finance/monthly-payments?month=${kpis.historicalCycle || prevCycleKey}&view=snapshot&status=pending`,
            description: cardText('historicalCycleDebt', 'description', { cycle: kpis.historicalCycleLabel || previousCycleName }),
            explanationVars: { cycle: kpis.historicalCycleLabel || previousCycleName },
            statValue: kpis.historicalCycleLabel || previousCycleName
        },
        {
            id: 'today-student-attendance',
            textKey: 'todayStudentAttendance',
            category: 'attendance',
            value: (kpis.todayStudentAttendance || 0).toLocaleString(),
            rawValue: kpis.todayStudentAttendance || 0,
            icon: <CalendarCheck size={20} />,
            color: 'bg-brand-500',
            badgeColor: 'bg-brand-50 text-brand-700 dark:bg-brand-950/50 dark:text-brand-300',
            path: '/attendance/students',
            subtitle: isCurrentActiveCycle ? (locale === 'so' ? 'Xaadirinta Maanta' : "Today's Attendance") : (locale === 'so' ? `Xaadirinta (${cycle})` : `Attendance (${cycle})`),
            explanationVars: { total: kpis.allStudents || kpis.totalStudents || 0 },
            statValue: (kpis.allStudents || kpis.totalStudents) ? `${Math.round(((kpis.todayStudentAttendance || 0) / (kpis.allStudents || kpis.totalStudents)) * 100)}%` : '0%',
            progress: (kpis.allStudents || kpis.totalStudents) ? ((kpis.todayStudentAttendance || 0) / (kpis.allStudents || kpis.totalStudents)) * 100 : undefined
        },
        {
            id: 'today-teacher-attendance',
            textKey: 'todayTeacherAttendance',
            category: 'attendance',
            value: (kpis.todayTeacherAttendance || 0).toLocaleString(),
            rawValue: kpis.todayTeacherAttendance || 0,
            icon: <CalendarCheck size={20} />,
            color: 'bg-pink-500',
            badgeColor: 'bg-pink-50 text-pink-700 dark:bg-pink-950/50 dark:text-pink-300',
            path: '/attendance/teachers',
            subtitle: isCurrentActiveCycle ? (locale === 'so' ? 'Xaadirinta Maanta' : "Today's Attendance") : (locale === 'so' ? `Xaadirinta (${cycle})` : `Attendance (${cycle})`),
            explanationVars: { total: kpis.allTeachers || kpis.totalTeachers || 0 },
            statValue: (kpis.allTeachers || kpis.totalTeachers) ? `${Math.round(((kpis.todayTeacherAttendance || 0) / (kpis.allTeachers || kpis.totalTeachers)) * 100)}%` : '0%',
            progress: (kpis.allTeachers || kpis.totalTeachers) ? ((kpis.todayTeacherAttendance || 0) / (kpis.allTeachers || kpis.totalTeachers)) * 100 : undefined
        }
    ].map((card) => ({
        ...card,
        label: cardText(card.textKey, 'label'),
        subtitle: cardText(card.textKey, 'subtitle'),
        badge: card.badge || cardText(card.textKey, 'badge'),
        description: card.description || cardText(card.textKey, 'description'),
        explanation: cardText(card.textKey, 'explanation', card.explanationVars),
        statLabel: cardText(card.textKey, 'statLabel'),
        actionText: cardText(card.textKey, 'actionText')
    }));

    const permittedCards = cardsConfig.filter(c => {
        if (c.category === 'finance' && !hasFinancePerm) return false;
        if (c.category === 'academic' && !hasAcademicPerm) return false;
        if (c.category === 'attendance' && !hasAttendancePerm) return false;
        return true;
    });

    const categoryTabs = [
        { id: 'all', label: t('dashboard.filters.all'), count: permittedCards.length },
        hasAcademicPerm && { id: 'academic', label: t('dashboard.filters.academic'), count: permittedCards.filter(c => c.category === 'academic').length },
        hasFinancePerm && { id: 'finance', label: t('dashboard.filters.finance'), count: permittedCards.filter(c => c.category === 'finance').length },
        hasAttendancePerm && { id: 'attendance', label: t('dashboard.filters.attendance'), count: permittedCards.filter(c => c.category === 'attendance').length },
    ].filter(Boolean);

    const filteredCards = activeCategory === 'all'
        ? permittedCards
        : permittedCards.filter(c => c.category === activeCategory);

    const activityRows = activities.length > 0
        ? activities.slice(0, 6).map((item) => ({
            title: `${tv(item.module) || t('dashboard.activity.system')} - ${item.detail || tv(item.action) || t('dashboard.activity.transaction')}`,
            time: item.date ? new Date(item.date).toLocaleTimeString(locale || [], { hour: '2-digit', minute: '2-digit' }) : t('dashboard.activity.justNow'),
            color: item.action === 'Expense' ? 'bg-rose-500' : item.action === 'Income' ? 'bg-emerald-500' : 'bg-blue-500',
        }))
        : [];

    return (
        <div className="mx-auto max-w-[1800px] space-y-6 sm:space-y-8 p-3 sm:p-6 md:p-8 pb-16 animate-in fade-in duration-500">
            {/* Hero Welcome Banner */}
            <section className="relative overflow-hidden rounded-3xl sm:rounded-[2.5rem] bg-gradient-to-br from-brand-700 via-brand-600 to-emerald-700 p-5 sm:p-7 md:p-10 text-white shadow-2xl shadow-brand-900/25 border border-white/15">
                <div className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-white/15 blur-3xl" />
                <div className="pointer-events-none absolute -bottom-32 -right-32 h-80 w-80 rounded-full bg-emerald-400/20 blur-3xl" />
                
                <div className="relative z-10 grid gap-6 sm:gap-8 xl:grid-cols-[1.2fr_0.8fr] items-center">
                    <div>
                        <div className="mb-4 sm:mb-5 inline-flex items-center gap-2.5 rounded-full bg-white/15 px-3.5 py-1.5 text-xs font-bold uppercase tracking-wider ring-1 ring-white/25 backdrop-blur-md">
                            <span className="relative flex h-2 w-2">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
                            </span>
                            <ShieldCheck size={15} /> {t('dashboard.hero.systemActive')}
                        </div>
                        <h1 className="text-2xl sm:text-3xl md:text-5xl font-extrabold tracking-tight text-white capitalize">
                            {locale
                                ? `Ku soo dhowow, ${currentUser?.fullName || currentUser?.username || 'Maamule'}!`
                                : `Welcome back, ${currentUser?.fullName || currentUser?.username || 'Admin'}!`}
                        </h1>
                        <p className="mt-3 max-w-2xl text-sm font-medium text-white/85 md:text-base leading-relaxed">
                            {t('dashboard.hero.intro')}
                        </p>
                        <div className="mt-6 flex flex-wrap items-center gap-3">
                            <div className="rounded-2xl bg-white/12 px-4 py-3 ring-1 ring-white/20 backdrop-blur-md">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">{t('dashboard.hero.today')}</p>
                                <p className="text-sm font-extrabold text-white mt-0.5">{locale ? `${today.getDate()} ${months[today.getMonth()]} ${today.getFullYear()}` : today.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</p>
                            </div>
                            <div className="rounded-2xl bg-white/12 px-4 py-3 ring-1 ring-white/20 backdrop-blur-md">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/70">{t('dashboard.hero.financialCycle')}</p>
                                <p className="text-sm font-extrabold text-white mt-0.5">{selectedCycle} · {billingCycleName}</p>
                            </div>
                            <button
                                onClick={() => fetchDashboardData(true, selectedCycle)}
                                disabled={isRefreshing}
                                className="flex items-center gap-2 rounded-2xl bg-white/15 px-4 py-3 text-xs font-bold text-white ring-1 ring-white/25 backdrop-blur-md transition-all hover:bg-white/25 active:scale-95"
                                title={t('dashboard.hero.refreshTitle')}
                            >
                                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                                <span>{isRefreshing ? t('dashboard.hero.refreshing') : t('dashboard.hero.refresh')}</span>
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {quickActions.map((action) => (
                            <button
                                key={action.title}
                                onClick={() => navigate(action.path)}
                                className="group rounded-3xl bg-white/12 p-4 text-left ring-1 ring-white/20 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:bg-white/20 hover:shadow-xl active:translate-y-0"
                            >
                                <div className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-brand-700 shadow-lg shadow-black/10 group-hover:scale-110 group-hover:shadow-brand-900/20 transition-all duration-300">
                                    {React.createElement(action.icon, { size: 20 })}
                                </div>
                                <p className="font-extrabold text-white tracking-tight">{action.title}</p>
                                <p className="text-xs font-medium text-white/75 mt-0.5">{action.subtitle}</p>
                            </button>
                        ))}
                    </div>
                </div>
            </section>

            {/* DEDICATED BILLING CYCLE SELECTOR BAR (Dashboard Cycle Control) */}
            <section className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm p-6 sm:p-7 flex flex-col md:flex-row items-start md:items-center justify-between gap-5 transition-all">
                <div className="flex items-center gap-4">
                    <div className="w-13 h-13 rounded-2xl bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 flex items-center justify-center shrink-0 border border-brand-200/50 shadow-sm">
                        <Calendar size={26} strokeWidth={2.5} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-black uppercase tracking-widest text-brand-600 dark:text-brand-400">
                                {locale ? 'Wareegga Xisaabeed ee Dashboard-ka' : 'Dashboard Billing Cycle'}
                            </span>
                            {isCurrentActiveCycle ? (
                                <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 text-[10px] font-black uppercase border border-emerald-200 dark:border-emerald-900">
                                    {locale ? '★ Bishan Hadda Jirta' : '★ Current Active Cycle'}
                                </span>
                            ) : (
                                <span className="px-2.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[10px] font-black uppercase border border-amber-200 dark:border-amber-900">
                                    {locale ? 'Wareeg Gaar ah' : 'Filtered Cycle'}
                                </span>
                            )}
                        </div>
                        <h2 className="text-base sm:text-xl font-black text-slate-900 dark:text-white capitalize tracking-tight mt-1">
                            {selectedCycle} · {billingCycleName}
                        </h2>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 sm:gap-3 w-full md:w-auto justify-end">
                    {/* Stepper buttons & Select Dropdown */}
                    <div className="inline-flex items-center bg-slate-50 dark:bg-slate-800/80 p-1.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 shadow-inner">
                        <button
                            type="button"
                            onClick={() => handleCycleChange(addCycles(selectedCycle, -1))}
                            className="p-2 rounded-xl text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700 transition-all active:scale-95 shadow-none hover:shadow-sm"
                            title={locale ? 'Wareeggii hore' : 'Previous Cycle'}
                        >
                            <ChevronLeft size={18} strokeWidth={2.5} />
                        </button>

                        <select
                            value={selectedCycle}
                            onChange={(e) => handleCycleChange(e.target.value)}
                            className="bg-transparent px-3 py-1.5 font-black text-xs text-slate-800 dark:text-slate-100 cursor-pointer focus:outline-none"
                        >
                            {cycleOptions.map((c) => (
                                <option key={c.key} value={c.key} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 font-bold">
                                    {c.label} {c.isCurrent ? `★ (${locale ? 'Bishan' : 'Current'})` : ''}
                                </option>
                            ))}
                        </select>

                        <button
                            type="button"
                            onClick={() => handleCycleChange(addCycles(selectedCycle, 1))}
                            className="p-2 rounded-xl text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white hover:bg-white dark:hover:bg-slate-700 transition-all active:scale-95 shadow-none hover:shadow-sm"
                            title={locale ? 'Wareegga xiga' : 'Next Cycle'}
                        >
                            <ChevronRight size={18} strokeWidth={2.5} />
                        </button>
                    </div>

                    {/* Quick Reset to Current Cycle */}
                    {!isCurrentActiveCycle && (
                        <button
                            type="button"
                            onClick={() => handleCycleChange(currentCycle())}
                            className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-brand-600 hover:bg-brand-700 text-white font-black text-xs uppercase tracking-wider shadow-sm transition-all active:scale-95"
                            title={locale ? 'Kusoo noqo wareegga bishan hadda jirta' : 'Return to current cycle'}
                        >
                            <RotateCcw size={14} strokeWidth={2.5} />
                            <span>{locale ? 'Bishan Hadda' : 'Current Cycle'}</span>
                        </button>
                    )}
                </div>
            </section>

            {/* KPI Cards Section with Category Filters */}
            <section className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-white md:text-2xl">
                                {t('dashboard.cardsTitle')}
                            </h2>
                            <span className="rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-black text-brand-700 dark:bg-brand-950/60 dark:text-brand-300">
                                {t('dashboard.cardsCount', { count: filteredCards.length })}
                            </span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                                {selectedCycle}
                            </span>
                        </div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                            {t('dashboard.cardsHint')}
                        </p>
                    </div>

                    {/* Filter Pills */}
                    <div className="flex items-center gap-1.5 overflow-x-auto rounded-2xl bg-slate-100/90 p-1.5 dark:bg-slate-800/90">
                        {categoryTabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveCategory(tab.id)}
                                className={`flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
                                    activeCategory === tab.id
                                        ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
                                        : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                                }`}
                            >
                                <span>{tab.label}</span>
                                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${activeCategory === tab.id ? 'bg-slate-100 dark:bg-slate-600 text-slate-700 dark:text-slate-200' : 'opacity-70'}`}>
                                    {tab.count}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Grid of Interactive Cards */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    {filteredCards.map((card) => (
                        <KPICard
                            key={card.id}
                            label={card.label}
                            value={card.value}
                            icon={card.icon}
                            color={card.color}
                            badge={card.badge}
                            badgeColor={card.badgeColor}
                            description={card.description}
                            progress={card.progress}
                            onClick={() => navigate(card.path)}
                            onPreview={() => setSelectedCardForModal(card)}
                        />
                    ))}
                </div>
            </section>

            {/* Recent Financial Activities & Notifications */}
            <div className={`grid grid-cols-1 gap-6 ${hasFinancePerm ? 'lg:grid-cols-2' : 'lg:grid-cols-1'}`}>
                {hasFinancePerm && (
                    <div className="rounded-[30px] bg-white p-6 shadow-sm border border-slate-100 dark:bg-slate-900 dark:border-slate-800">
                        <div className="mb-6 flex items-start justify-between">
                            <div>
                                <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">{t('dashboard.recentTransactions')}</h3>
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                    {t('dashboard.financialActivity')} ({selectedCycle})
                                </p>
                            </div>
                            <button
                                onClick={() => navigate(`/finance/cashbook?month=${selectedCycle}`)}
                                className="text-xs font-bold text-brand-600 hover:text-brand-700 flex items-center gap-1 transition-colors"
                            >
                                <span>{t('dashboard.viewAll')}</span>
                                <ArrowRight size={14} />
                            </button>
                        </div>
                        <div className="space-y-3">
                            {activityRows.length > 0 ? (
                                activityRows.map((act, index) => (
                                    <div key={index} className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 hover:bg-slate-100/80 dark:hover:bg-slate-800 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-3 h-3 rounded-full ${act.color}`} />
                                            <div>
                                                <p className="text-sm font-bold text-slate-900 dark:text-white">{act.title}</p>
                                                <p className="text-xs text-slate-400">{act.time}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="py-8 text-center text-sm font-medium text-slate-400">{t('dashboard.noTransactions')}</div>
                            )}
                        </div>
                    </div>
                )}

                <div className="rounded-[30px] bg-white p-6 shadow-sm border border-slate-100 dark:bg-slate-900 dark:border-slate-800">
                    <div className="mb-6 flex items-start justify-between">
                        <div>
                            <h3 className="font-black uppercase tracking-tight text-slate-900 dark:text-white">{t('dashboard.systemNotifications')}</h3>
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{t('dashboard.alertsReminders')}</p>
                        </div>
                    </div>
                    <div className="space-y-3">
                        {notifications.length > 0 ? (
                            notifications.slice(0, 5).map((note) => (
                                <div key={note._id || note.id} className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                                    <p className="text-sm font-bold text-slate-900 dark:text-white">{translateApiMessage(note.title)}</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{translateApiMessage(note.message)}</p>
                                </div>
                            ))
                        ) : (
                            <div className="py-8 text-center text-sm font-medium text-slate-400">{t('dashboard.noNotifications')}</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Quick Detail Modal for Selected Card */}
            {selectedCardForModal && (
                <div 
                    role="dialog"
                    aria-modal="true"
                    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={() => setSelectedCardForModal(null)}
                >
                    <div
                        className="relative w-full max-w-lg overflow-hidden rounded-[2.5rem] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900 md:p-8 animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Close button */}
                        <button
                            onClick={() => setSelectedCardForModal(null)}
                            className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 transition-colors"
                        >
                            <X size={18} />
                        </button>

                        {/* Modal Header */}
                        <div className="flex items-center gap-4 mb-5">
                            <div className={`p-4 rounded-2xl ${selectedCardForModal.color} text-white shadow-lg`}>
                                {selectedCardForModal.icon}
                            </div>
                            <div>
                                <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-1 ${selectedCardForModal.badgeColor}`}>
                                    {selectedCardForModal.badge}
                                </span>
                                <h3 className="text-lg font-extrabold text-slate-900 dark:text-white">
                                    {selectedCardForModal.label}
                                </h3>
                                <p className="text-xs font-semibold text-brand-600 dark:text-brand-400">
                                    {selectedCardForModal.subtitle}
                                </p>
                            </div>
                        </div>

                        {/* Metric Value Card */}
                        <div className="mb-6 rounded-3xl bg-slate-50 p-5 border border-slate-100 dark:bg-slate-800/50 dark:border-slate-800">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">
                                {t('dashboard.modal.liveValue')}
                            </p>
                            <div className="text-3xl font-black text-slate-900 dark:text-white tabular-nums">
                                {selectedCardForModal.value}
                            </div>
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                                {selectedCardForModal.description}
                            </p>
                        </div>

                        {/* Explanation Content */}
                        <div className="space-y-4 mb-6">
                            <div>
                                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-400 mb-1.5">
                                    {t('dashboard.modal.explanation')}
                                </h4>
                                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 leading-relaxed bg-brand-50/50 dark:bg-brand-950/20 p-4 rounded-2xl border border-brand-100/60 dark:border-brand-900/30">
                                    {selectedCardForModal.explanation}
                                </p>
                            </div>

                            {/* Sub Statistic */}
                            {selectedCardForModal.statLabel && (
                                <div className="flex items-center justify-between p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                                    <span className="text-xs font-bold text-slate-600 dark:text-slate-400">
                                        {selectedCardForModal.statLabel}
                                    </span>
                                    <span className="text-sm font-black text-slate-900 dark:text-white">
                                        {selectedCardForModal.statValue}
                                    </span>
                                </div>
                            )}
                        </div>

                        {/* Footer Action Buttons */}
                        <div className="flex items-center gap-3">
                            <button
                                type="button"
                                onClick={() => setSelectedCardForModal(null)}
                                className="flex-1 rounded-2xl border border-slate-200 py-3.5 text-xs font-bold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors"
                            >
                                {t('dashboard.modal.close')}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    const path = selectedCardForModal.path;
                                    setSelectedCardForModal(null);
                                    navigate(path);
                                }}
                                className="flex-[1.5] flex items-center justify-center gap-2 rounded-2xl bg-brand-600 py-3.5 text-xs font-bold text-white shadow-lg shadow-brand-600/30 hover:bg-brand-700 active:scale-95 transition-all"
                            >
                                <span>{selectedCardForModal.actionText || t('dashboard.modal.goToPage')}</span>
                                <ExternalLink size={15} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DashboardOverview;
