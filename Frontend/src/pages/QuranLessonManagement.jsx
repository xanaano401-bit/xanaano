import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  BookOpen,
  CheckCircle2,
  RotateCcw,
  Search,
  Printer,
  FileDown,
  UserCheck,
  Calendar,
  Layers,
  ChevronDown,
  Filter,
  Plus,
  RefreshCw,
  Award,
  Trash2,
  Edit2,
  X,
  BookmarkCheck,
  Sparkles,
  Clock,
  BookMarked,
  Building2
} from 'lucide-react';
import api from '../services/api';
import { QURAN_SURAHS } from '../data/quranSurahs';
import jsPDF from 'jspdf';

const LESSON_TYPES = [
  { id: 'sabaq', labelSo: 'Sabaq (Cashir Cusub)', labelAr: 'السبق (الدرس الجديد)', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' },
  { id: 'sabqi', labelSo: 'Sabqi (Sabaq-doraad)', labelAr: 'السبقي (الدرس السابق)', color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800' },
  { id: 'manzil', labelSo: 'Manzil (Murajaco)', labelAr: 'المنزل (المراجعة العامة)', color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800' },
  { id: 'dars', labelSo: 'Dars (Akhris Caadi)', labelAr: 'درس تلاوة', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' }
];

const QuranLessonManagement = () => {
  // Branch states
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');

  // Data states
  const [records, setRecords] = useState([]);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  // Form states (aligned with daily lesson workflow)
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentSearchQuery, setStudentSearchQuery] = useState('');
  const [isStudentDropdownOpen, setIsStudentDropdownOpen] = useState(false);

  const [halaqahName, setHalaqahName] = useState('');
  const [classId, setClassId] = useState('');

  const [selectedSurah, setSelectedSurah] = useState(null);
  const [surahSearchQuery, setSurahSearchQuery] = useState('');
  const [isSurahDropdownOpen, setIsSurahDropdownOpen] = useState(false);

  const [fromVerse, setFromVerse] = useState(1);
  const [toVerse, setToVerse] = useState('');
  const [lessonType, setLessonType] = useState('sabaq');

  const [status, setStatus] = useState('passed'); // 'passed' | 'repeat' | 'in_progress'
  const [repeatCount, setRepeatCount] = useState(3);
  const [note, setNote] = useState('');
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Edit modal state
  const [editingRecord, setEditingRecord] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Filters
  const [searchFilter, setSearchFilter] = useState('');
  const [halaqahFilter, setHalaqahFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [lessonTypeFilter, setLessonTypeFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');

  // Refs for click outside
  const studentDropdownRef = useRef(null);
  const surahDropdownRef = useRef(null);
  const surahInputRef = useRef(null);

  // Fetch initial data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [lessonsRes, studentsRes, classesRes, branchesRes] = await Promise.all([
        api.get('/quran/lessons').catch(() => ({ data: [] })),
        api.get('/students').catch(() => ({ data: [] })),
        api.get('/classes').catch(() => ({ data: [] })),
        api.get('/branches').catch(() => ({ data: [] }))
      ]);

      const branchList = branchesRes.data || [];
      setBranches(branchList);
      setRecords(lessonsRes.data || []);
      setStudents(studentsRes.data || []);
      setClasses(classesRes.data || []);

      if (!selectedBranchId && branchList.length > 0) {
        const dugsiBranch = branchList.find(b => b.name && b.name.toLowerCase().includes('dugsi'));
        if (dugsiBranch) {
          setSelectedBranchId(dugsiBranch._id);
        } else {
          setSelectedBranchId(branchList[0]._id);
        }
      }
    } catch (err) {
      console.error('Error loading Quran lesson data:', err);
      setMessage({ type: 'error', text: 'Khalad ayaa dhacay markii xogta la soo qaadayay.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Click outside listener for dropdowns
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (studentDropdownRef.current && !studentDropdownRef.current.contains(event.target)) {
        setIsStudentDropdownOpen(false);
      }
      if (surahDropdownRef.current && !surahDropdownRef.current.contains(event.target)) {
        setIsSurahDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter students based on branch
  const branchStudents = useMemo(() => {
    if (!selectedBranchId || selectedBranchId === 'ALL' || selectedBranchId === 'All') return students;
    return students.filter(s => {
      const sBranchId = String(s.branchId?._id || s.branchId || '');
      const cBranchId = String(s.classId?.branchId?._id || s.classId?.branchId || '');
      const target = String(selectedBranchId);
      return sBranchId === target || cBranchId === target;
    });
  }, [students, selectedBranchId]);

  // Filter classes based on branch
  const branchClasses = useMemo(() => {
    if (!selectedBranchId || selectedBranchId === 'ALL' || selectedBranchId === 'All') return classes;
    return classes.filter(c => {
      const bId = String(c.branchId?._id || c.branchId || '');
      return bId === String(selectedBranchId);
    });
  }, [classes, selectedBranchId]);

  // Filter students for autocomplete
  const filteredStudents = useMemo(() => {
    if (!studentSearchQuery.trim()) return branchStudents.slice(0, 15);
    const q = studentSearchQuery.toLowerCase().trim();
    return branchStudents.filter(s =>
      (s.fullName && s.fullName.toLowerCase().includes(q)) ||
      (s.studentCode && s.studentCode.toLowerCase().includes(q)) ||
      (s.rollNumber && s.rollNumber.toString().includes(q)) ||
      (s.classId?.name && s.classId.name.toLowerCase().includes(q)) ||
      (s.classId?.className && s.classId.className.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [branchStudents, studentSearchQuery]);

  // Filter 114 Surahs based on query (shows all 114 surahs in order)
  const filteredSurahs = useMemo(() => {
    if (!surahSearchQuery.trim() || (selectedSurah && surahSearchQuery === `${selectedSurah.number}. ${selectedSurah.nameAr} (${selectedSurah.nameSo})`)) {
      return QURAN_SURAHS;
    }
    const q = surahSearchQuery.toLowerCase().trim();
    return QURAN_SURAHS.filter(s =>
      s.nameAr.includes(q) ||
      (s.nameSo && s.nameSo.toLowerCase().includes(q)) ||
      String(s.number).includes(q)
    );
  }, [surahSearchQuery, selectedSurah]);

  // Handle selecting a student
  const handleSelectStudent = (student) => {
    setSelectedStudent(student);
    setStudentSearchQuery(student.fullName || '');

    const resolvedHalaqah =
      student.classId?.name ||
      student.classId?.className ||
      (typeof student.classId === 'string'
        ? classes.find(c => c._id === student.classId)?.name || ''
        : '');

    setHalaqahName(resolvedHalaqah);
    setClassId(student.classId?._id || student.classId || '');

    setIsStudentDropdownOpen(false);

    // Keep surah, verse and note blank ready for entry
    setSelectedSurah(null);
    setSurahSearchQuery('');
    setFromVerse(1);
    setToVerse('');
    setNote('');
    setStatus('passed');
    setRepeatCount(3);
    setTimeout(() => {
      if (surahInputRef.current) surahInputRef.current.focus();
    }, 50);
  };

  // Handle selecting a Surah
  const handleSelectSurah = (surah) => {
    setSelectedSurah(surah);
    setSurahSearchQuery(`${surah.number}. ${surah.nameAr} (${surah.nameSo})`);
    setIsSurahDropdownOpen(false);
    if (!toVerse || Number(toVerse) > surah.verses) {
      setToVerse(Math.min(surah.verses, 10));
    }
  };

  // Handle form submit
  const handleSubmitRecord = async (e) => {
    e.preventDefault();

    if (!selectedStudent && !studentSearchQuery.trim()) {
      setMessage({ type: 'error', text: 'Fadlan dooro ama qor magaca ardayga.' });
      return;
    }

    if (!selectedSurah && !surahSearchQuery.trim()) {
      setMessage({ type: 'error', text: 'Fadlan dooro suuradda cashirka.' });
      return;
    }

    setSubmitting(true);
    setMessage(null);

    try {
      const payload = {
        studentId: selectedStudent?._id,
        studentName: selectedStudent?.fullName || studentSearchQuery.trim(),
        classId: classId || undefined,
        halaqahName: halaqahName.trim(),
        branchId: selectedBranchId && selectedBranchId !== 'ALL' ? selectedBranchId : undefined,
        surahName: selectedSurah ? `${selectedSurah.number}. ${selectedSurah.nameAr} (${selectedSurah.nameSo})` : surahSearchQuery.trim(),
        surahNumber: selectedSurah ? selectedSurah.number : undefined,
        fromVerse: Number(fromVerse) || 1,
        toVerse: toVerse ? Number(toVerse) : undefined,
        lessonType,
        status,
        repeatCount: status === 'repeat' ? Number(repeatCount) || 1 : 1,
        note: note.trim(),
        date: recordDate
      };

      const res = await api.post('/quran/lessons', payload);

      setRecords(prev => [res.data, ...prev]);
      setMessage({ type: 'success', text: `Cashirka ardayga "${payload.studentName}" si guul leh ayaa loo diiwaangeliyey!` });

      // Reset fields for next entry (keep student selected or ready for next)
      setSelectedSurah(null);
      setSurahSearchQuery('');
      setFromVerse(1);
      setToVerse('');
      setNote('');
      setStatus('passed');
      setRepeatCount(3);
    } catch (err) {
      console.error('Error saving Quran lesson record:', err);
      setMessage({ type: 'error', text: err.response?.data?.message || 'Khalad ayaa dhacay markii cashirka la keydinayay.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle update record
  const handleUpdateRecord = async (e) => {
    e.preventDefault();
    if (!editingRecord) return;

    try {
      setSubmitting(true);
      const res = await api.put(`/quran/lessons/${editingRecord._id}`, editingRecord);
      setRecords(prev => prev.map(r => r._id === editingRecord._id ? res.data : r));
      setIsEditModalOpen(false);
      setEditingRecord(null);
      setMessage({ type: 'success', text: 'Cashirka si guul leh ayaa loo cusbooneysiiyey!' });
    } catch (err) {
      console.error('Error updating Quran lesson record:', err);
      setMessage({ type: 'error', text: err.response?.data?.message || 'Khalad ayaa dhacay markii la cusboonaysiinayay.' });
    } finally {
      setSubmitting(false);
    }
  };

  // Handle delete record
  const handleDeleteRecord = async (record) => {
    if (!window.confirm(`Ma hubtaa inaad tirto diiwaanka cashirka ee "${record.studentName}"?`)) {
      return;
    }

    try {
      await api.delete(`/quran/lessons/${record._id}`);
      setRecords(prev => prev.filter(r => r._id !== record._id));
      setMessage({ type: 'success', text: 'Diiwaanka cashirka waa la tirtiray.' });
    } catch (err) {
      console.error('Error deleting Quran lesson record:', err);
      setMessage({ type: 'error', text: 'Khalad ayaa dhacay markii diiwaanka la tirayay.' });
    }
  };

  // Filtered records for table
  const displayedRecords = useMemo(() => {
    return records.filter(r => {
      const targetBranch = String(selectedBranchId || '');
      const matchBranch = !selectedBranchId || selectedBranchId === 'ALL' || selectedBranchId === 'All' ||
        String(r.branchId?._id || r.branchId || '') === targetBranch ||
        String(r.studentId?.branchId?._id || r.studentId?.branchId || '') === targetBranch ||
        String(r.classId?.branchId?._id || r.classId?.branchId || '') === targetBranch;

      const matchSearch = !searchFilter.trim() ||
        (r.studentName && r.studentName.toLowerCase().includes(searchFilter.toLowerCase())) ||
        (r.surahName && r.surahName.toLowerCase().includes(searchFilter.toLowerCase())) ||
        (r.halaqahName && r.halaqahName.toLowerCase().includes(searchFilter.toLowerCase())) ||
        (r.note && r.note.toLowerCase().includes(searchFilter.toLowerCase()));

      const matchHalaqah = halaqahFilter === 'All' || r.halaqahName === halaqahFilter;
      const matchStatus = statusFilter === 'All' || r.status === statusFilter;
      const matchType = lessonTypeFilter === 'All' || r.lessonType === lessonTypeFilter;
      const matchDate = !dateFilter || (r.date && r.date.slice(0, 10) === dateFilter);

      return matchBranch && matchSearch && matchHalaqah && matchStatus && matchType && matchDate;
    });
  }, [records, selectedBranchId, searchFilter, halaqahFilter, statusFilter, lessonTypeFilter, dateFilter]);

  // Unique halaqahs for filter
  const uniqueHalaqahs = useMemo(() => {
    const set = new Set();
    records.forEach(r => {
      if (r.halaqahName) set.add(r.halaqahName);
    });
    branchClasses.forEach(c => {
      if (c.name) set.add(c.name);
      if (c.className) set.add(c.className);
    });
    return Array.from(set).filter(Boolean);
  }, [records, branchClasses]);

  // KPI statistics
  const stats = useMemo(() => {
    const total = records.length;
    const passed = records.filter(r => r.status === 'passed').length;
    const repeat = records.filter(r => r.status === 'repeat').length;
    const inProgress = records.filter(r => r.status === 'in_progress').length;
    const uniqueStudents = new Set(records.map(r => r.studentName)).size;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    return { total, passed, repeat, inProgress, uniqueStudents, passRate };
  }, [records]);

  // Print function
  const handlePrint = () => {
    window.print();
  };

  // PDF Export using jsPDF
  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header Top English / Somali
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('CULUUMTA SHARECADA & CARABIGA EE SALAAX AL-DAAREYN', pageWidth / 2, 16, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('ELASHA - SOMALIA', pageWidth / 2, 22, { align: 'center' });

    // Decorative line
    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.line(15, 25, pageWidth - 15, 25);

    // Title
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(5, 150, 105);
    doc.text('JADWALKA CASHIRADA EE QUR\'AANKA KARIIMKA', pageWidth / 2, 33, { align: 'center' });
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text('(Jadwal Al-Duroos Lil-Qur\'an Al-Kareem)', pageWidth / 2, 38, { align: 'center' });

    // Meta row
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Taariikhda Daabacaadda: ${new Date().toLocaleDateString('so-SO')}`, 15, 45);
    doc.text(`Wadarta Diiwaannada: ${displayedRecords.length}`, pageWidth - 15, 45, { align: 'right' });

    // Table Header
    const startY = 49;
    const colX = {
      num: 15,
      name: 24,
      halaqah: 72,
      surah: 104,
      range: 135,
      type: 155,
      status: 175
    };

    doc.setFillColor(241, 245, 249);
    doc.rect(15, startY, pageWidth - 30, 8, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.rect(15, startY, pageWidth - 30, 8, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text('#', colX.num + 2, startY + 5.5);
    doc.text('Magaca Ardayga', colX.name, startY + 5.5);
    doc.text('Xalaqadda', colX.halaqah, startY + 5.5);
    doc.text('Suuradda', colX.surah, startY + 5.5);
    doc.text('Aayadaha', colX.range, startY + 5.5);
    doc.text('Nooca', colX.type, startY + 5.5);
    doc.text('Natiijada', colX.status, startY + 5.5);

    let curY = startY + 8;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);

    displayedRecords.forEach((r, idx) => {
      if (curY > 265) {
        doc.addPage();
        curY = 20;
      }

      if (idx % 2 === 1) {
        doc.setFillColor(248, 250, 252);
        doc.rect(15, curY, pageWidth - 30, 7, 'F');
      }
      doc.setDrawColor(226, 232, 240);
      doc.rect(15, curY, pageWidth - 30, 7, 'S');

      doc.setTextColor(71, 85, 105);
      doc.text(`${idx + 1}`, colX.num + 2, curY + 5);
      doc.text((r.studentName || '-').slice(0, 25), colX.name, curY + 5);
      doc.text((r.halaqahName || '-').slice(0, 16), colX.halaqah, curY + 5);
      doc.text((r.surahName || '-').slice(0, 16), colX.surah, curY + 5);

      const rangeText = r.toVerse ? `${r.fromVerse || 1}-${r.toVerse}` : `${r.fromVerse || 1}...`;
      doc.text(rangeText, colX.range, curY + 5);
      doc.text(r.lessonType ? r.lessonType.toUpperCase() : 'SABAQ', colX.type, curY + 5);

      const statusSymbol = r.status === 'passed' ? 'Pass (Gudbay)' : (r.status === 'repeat' ? `Tikraar (${r.repeatCount || 1}x)` : 'Wadaa');
      if (r.status === 'passed') {
        doc.setTextColor(5, 150, 105);
      } else if (r.status === 'repeat') {
        doc.setTextColor(217, 119, 6);
      } else {
        doc.setTextColor(59, 130, 246);
      }
      doc.text(statusSymbol, colX.status, curY + 5);

      curY += 7;
    });

    // Signature Area
    const sigY = Math.min(curY + 18, 270);
    doc.setDrawColor(148, 163, 184);
    doc.line(25, sigY, 85, sigY);
    doc.line(pageWidth - 85, sigY, pageWidth - 25, sigY);

    doc.setFontSize(8);
    doc.setTextColor(71, 85, 105);
    doc.text('Togiiqa Macallinka Cashirka', 55, sigY + 5, { align: 'center' });
    doc.text('Shaabadda & Saxiixa Maamulka', pageWidth - 55, sigY + 5, { align: 'center' });

    doc.save(`Jadwalka_Cashirada_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-[1700px] mx-auto animate-in fade-in duration-500 pb-28">

      {/* ========================================================================= */}
      {/* 1. TOP HEADER BANNER (SCREEN ONLY) */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-br from-emerald-950 via-teal-900 to-slate-950 rounded-[32px] p-6 sm:p-8 lg:p-10 text-white border border-teal-800/40 shadow-2xl relative overflow-hidden print:hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-300 text-xs font-bold tracking-wide">
              <Sparkles size={14} className="animate-spin text-teal-300" style={{ animationDuration: '6s' }} />
              <span>Machadka Culuumta Shareecada & Carabiga ee Salaax Al-Daareyn</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/30">
                <BookmarkCheck size={26} className="text-slate-950 stroke-[2.5]" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white flex items-center gap-3">
                  <span>Jadwalka Cashirada</span>
                  <span className="text-xl sm:text-2xl text-teal-300 font-arabic font-normal">(جدول الدروس)</span>
                </h1>
                <p className="text-teal-100/80 text-sm mt-0.5">
                  Diiwaangelinta cashirka maalinlaha ah (Sabaq, Sabqi, Manzil) & aayadaha arday kasta
                </p>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            {/* Branch Indicator & Switcher */}
            <div className="flex items-center gap-2 px-3.5 py-2 rounded-2xl bg-white/10 dark:bg-slate-800/80 border border-teal-500/30 backdrop-blur-md">
              <Building2 size={16} className="text-teal-400 shrink-0" />
              <div className="flex flex-col">
                <span className="text-[9px] font-black uppercase tracking-wider text-teal-300/80">Laanta:</span>
                <select
                  value={selectedBranchId}
                  onChange={(e) => setSelectedBranchId(e.target.value)}
                  className="bg-transparent text-teal-200 font-black text-xs border-none focus:outline-none cursor-pointer pr-2"
                >
                  {branches.map(b => {
                    const isDugsi = b.name && b.name.toLowerCase().includes('dugsi');
                    return (
                      <option key={b._id} value={b._id} className="bg-slate-900 text-white">
                        {b.name} {isDugsi ? '(Dugsiga)' : ''}
                      </option>
                    );
                  })}
                  <option value="ALL" className="bg-slate-900 text-white">Dhammaan Laamaha (All)</option>
                </select>
              </div>
            </div>

            <button
              onClick={handlePrint}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all border border-white/10 backdrop-blur-md active:scale-95"
            >
              <Printer size={16} />
              <span>Daabac Jadwalka</span>
            </button>

            <button
              onClick={handleExportPDF}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-black transition-all shadow-lg shadow-teal-500/30 active:scale-95"
            >
              <FileDown size={16} />
              <span>Soo Deji PDF</span>
            </button>

            <button
              onClick={fetchData}
              disabled={loading}
              className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10 active:scale-95"
              title="Dib-u-cusboonaysii"
            >
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. STATS OVERVIEW CARDS (SCREEN ONLY) */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 print:hidden">
        {/* Total Lessons */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Wadarta Cashirada</p>
            <div className="w-9 h-9 rounded-2xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <BookmarkCheck size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
            {stats.total}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Diiwaan maalinle ah</p>
        </div>

        {/* Passed (Dhameystay) */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-emerald-100 dark:border-emerald-950/60 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Gudbay (Dhameystay)</p>
            <div className="w-9 h-9 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
            {stats.passed}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Aayadaha si fiican u akhriyey</p>
        </div>

        {/* Repeat (Tikraar) */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-amber-100 dark:border-amber-950/60 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-amber-600 dark:text-amber-400">Tikraar (Dib-u-akhris)</p>
            <div className="w-9 h-9 rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
              <RotateCcw size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400 mt-2">
            {stats.repeat}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">U baahan ku celcelin</p>
        </div>

        {/* Unique Students */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Ardayda Firfircoon</p>
            <div className="w-9 h-9 rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
              <UserCheck size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
            {stats.uniqueStudents}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Arday leh cashir</p>
        </div>

        {/* Pass Rate */}
        <div className="col-span-2 lg:col-span-1 bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Heerka Guusha</p>
            <div className="w-9 h-9 rounded-2xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <Award size={18} />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-black text-teal-600 dark:text-teal-400 mt-2">
            {stats.passRate}%
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Heerka gudbista cashirada</p>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. NOTIFICATION MESSAGE */}
      {/* ========================================================================= */}
      {message && (
        <div
          className={`p-4 rounded-2xl text-sm font-bold flex items-center justify-between gap-3 animate-in fade-in duration-300 print:hidden ${
            message.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
          }`}
        >
          <div className="flex items-center gap-2">
            {message.type === 'success' ? <CheckCircle2 size={18} /> : <X size={18} />}
            <span>{message.text}</span>
          </div>
          <button onClick={() => setMessage(null)} className="text-xs font-bold opacity-60 hover:opacity-100">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. MAIN ENTRY FORM (SCREEN ONLY) */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-slate-900 rounded-[32px] p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800 shadow-xl print:hidden">
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
              <Plus className="text-teal-600" size={20} />
              <span>Diiwaangeli Cashir Cusub</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Dooro ardayga (si toos ah ayaa loo buuxinayaa fasalka), kadibna dooro suuradda, aayadaha, iyo nooca cashirka.
            </p>
          </div>
          <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
            Foomka Tooska ah
          </span>
        </div>

        <form onSubmit={handleSubmitRecord} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">

            {/* Field 1: Dooro Ardayga (Searchable Dropdown) */}
            <div className="relative" ref={studentDropdownRef}>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                <span>1. Ardayga (الطالب) *</span>
                {selectedStudent && (
                  <span className="text-[10px] text-teal-600 dark:text-teal-400 font-bold">
                    #{selectedStudent.rollNumber || selectedStudent.studentCode || ''}
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="Raadi magaca ama lambarka ardayga..."
                  value={studentSearchQuery}
                  onChange={(e) => {
                    setStudentSearchQuery(e.target.value);
                    setIsStudentDropdownOpen(true);
                  }}
                  onFocus={() => setIsStudentDropdownOpen(true)}
                  className="w-full px-4 py-3 pl-10 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                />
                <Search size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
                {studentSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setStudentSearchQuery('');
                      setSelectedStudent(null);
                      setHalaqahName('');
                      setClassId('');
                    }}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* Student Dropdown List */}
              {isStudentDropdownOpen && filteredStudents.length > 0 && (
                <div className="absolute z-30 left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                  {filteredStudents.map((s) => (
                    <div
                      key={s._id}
                      onClick={() => handleSelectStudent(s)}
                      className="p-3 hover:bg-teal-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between transition-colors"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-white">
                          {s.fullName}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          {s.classId?.name || s.classId?.className || 'Xalaqo la\'aan'} • #{s.rollNumber || s.studentCode || 'N/A'}
                        </p>
                      </div>
                      <span className="text-xs font-bold text-teal-600">Dooro</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Field 2: Xalqada / Fasalka (Auto-filled) */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                <span>2. Xalqada / Fasalka (الحلقة)</span>
                <span className="text-[10px] text-slate-400">Toos u buuxsantay</span>
              </label>
              <input
                type="text"
                placeholder="Fasalka ama xalqada..."
                value={halaqahName}
                onChange={(e) => setHalaqahName(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-teal-50/50 dark:bg-slate-800/80 border border-teal-200 dark:border-slate-700 text-sm font-bold text-teal-950 dark:text-teal-300 focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
              />
            </div>

            {/* Field 3: Suuradda (114 Surahs Dropdown) */}
            <div className="relative" ref={surahDropdownRef}>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                <span>3. Suuradda (السورة) *</span>
                {selectedSurah && (
                  <span className="text-[10px] text-teal-600 dark:text-teal-400 font-bold">
                    #{selectedSurah.number} ({selectedSurah.verses} aayadood)
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  ref={surahInputRef}
                  type="text"
                  required
                  placeholder="Dooro suuradda (114 diyaar ah)..."
                  value={surahSearchQuery}
                  onChange={(e) => {
                    setSurahSearchQuery(e.target.value);
                    setIsSurahDropdownOpen(true);
                  }}
                  onFocus={() => setIsSurahDropdownOpen(true)}
                  className="w-full px-4 py-3 pl-10 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all font-arabic"
                />
                <BookOpen size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
                {surahSearchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSurahSearchQuery('');
                      setSelectedSurah(null);
                    }}
                    className="absolute right-3 top-3 text-slate-400 hover:text-slate-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              {/* Surah Dropdown List (All 114) */}
              {isSurahDropdownOpen && filteredSurahs.length > 0 && (
                <div className="absolute z-30 left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                  <div className="px-3 py-2 bg-slate-50 dark:bg-slate-700/60 sticky top-0 z-10 flex items-center justify-between text-[11px] font-bold text-slate-500 dark:text-slate-300 border-b border-slate-100 dark:border-slate-700">
                    <span>114 Suuradood ({filteredSurahs.length} diyaar ah)</span>
                    <span className="text-[10px] text-teal-600 dark:text-teal-400">Dooro mid</span>
                  </div>
                  {filteredSurahs.map((surah) => (
                    <div
                      key={surah.number}
                      onClick={() => handleSelectSurah(surah)}
                      className="p-3 hover:bg-teal-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-xs font-black text-slate-600 dark:text-slate-300">
                          {surah.number}
                        </span>
                        <div>
                          <p className="text-sm font-bold text-slate-900 dark:text-white font-arabic">
                            {surah.nameAr}
                          </p>
                          <p className="text-[11px] text-slate-400">{surah.nameSo} ({surah.verses} aayadood)</p>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-teal-600">Dooro</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Field 4: Taariikhda (التاريخ) */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                4. Taariikhda (التاريخ) *
              </label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={recordDate}
                  onChange={(e) => setRecordDate(e.target.value)}
                  className="w-full px-4 py-3 pl-10 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                />
                <Calendar size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
              </div>
            </div>

          </div>

          {/* Row 2: Aayadaha Range & Nooca Cashirka */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-1">

            {/* Aayadaha: From Verse */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                5. Laga bilaabo Aayadda (من الآية)
              </label>
              <input
                type="number"
                min="1"
                max={selectedSurah ? selectedSurah.verses : 286}
                value={fromVerse}
                onChange={(e) => setFromVerse(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
              />
            </div>

            {/* Aayadaha: To Verse */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                <span>6. Ilaa Aayadda (إلى الآية)</span>
                {selectedSurah && (
                  <span className="text-[10px] text-slate-400">Wadarta: {selectedSurah.verses}</span>
                )}
              </label>
              <input
                type="number"
                min="1"
                max={selectedSurah ? selectedSurah.verses : 286}
                placeholder={selectedSurah ? `ilaa ${selectedSurah.verses}` : 'Tusaale: 15'}
                value={toVerse}
                onChange={(e) => setToVerse(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
              />
            </div>

            {/* Nooca Cashirka (Lesson Type) */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                7. Nooca Cashirka (نوع الدرس)
              </label>
              <select
                value={lessonType}
                onChange={(e) => setLessonType(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
              >
                {LESSON_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.labelSo}</option>
                ))}
              </select>
            </div>

            {/* Status (Gudbay / Tikraar) */}
            <div>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                8. Xaaladda Cashirka (النتيجة) *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('passed')}
                  className={`py-2.5 px-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
                    status === 'passed'
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-600/30'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <CheckCircle2 size={16} />
                  <span>Gudbay ✓</span>
                </button>

                <button
                  type="button"
                  onClick={() => setStatus('repeat')}
                  className={`py-2.5 px-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 border transition-all ${
                    status === 'repeat'
                      ? 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-600/30'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <RotateCcw size={16} />
                  <span>Tikraar ↺</span>
                </button>
              </div>
            </div>

          </div>

          {/* Row 3: Tikraar Count (Conditional) & Note */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-1">

            {/* Mulaaxadada (الملاحظة) */}
            <div className={status === 'repeat' ? 'lg:col-span-2 space-y-2' : 'lg:col-span-3 space-y-2'}>
              <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                9. Mulaaxadada Macallinka (الملاحظة)
              </label>
              <input
                type="text"
                placeholder="Xusuusin ama tilmaan ku saabsan akhriska..."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
              />

              {/* Quick note suggestions */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <span className="text-[10px] text-slate-400 font-bold">Xusuusin degdeg ah:</span>
                {['Aad buu u fiican yahay', 'Tajweedka ha xoojiyo', 'Akhriska wuu hagaajiyay', 'U baahan dhageysi dheeraad ah'].map((phrase) => (
                  <button
                    key={phrase}
                    type="button"
                    onClick={() => setNote(phrase)}
                    className="text-[10px] font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-teal-50 dark:hover:bg-slate-700 hover:text-teal-600 transition-colors"
                  >
                    + {phrase}
                  </button>
                ))}
              </div>
            </div>

            {/* Tikraar Count Selection (Visible when status === 'repeat') */}
            {status === 'repeat' && (
              <div className="bg-amber-50/70 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/60 rounded-2xl p-4 space-y-3 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                    <RotateCcw size={14} className="text-amber-600" />
                    <span>Tirada Tikraarka (عدد التكرار)</span>
                  </label>
                  <span className="text-xs font-black text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/60">
                    {repeatCount} jeer
                  </span>
                </div>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {[1, 2, 3, 5, 7, 10].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setRepeatCount(num)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all ${
                        Number(repeatCount) === num
                          ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 scale-105'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-amber-200 dark:border-slate-700 hover:bg-amber-100/50'
                      }`}
                    >
                      {num}x
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-bold">Geli tiro:</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={repeatCount}
                    onChange={(e) => setRepeatCount(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-20 px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-center font-black text-sm text-amber-950 dark:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                  <span className="text-[11px] text-slate-400">jeer dib u akhris</span>
                </div>
              </div>
            )}

          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setSelectedStudent(null);
                setStudentSearchQuery('');
                setHalaqahName('');
                setClassId('');
                setSelectedSurah(null);
                setSurahSearchQuery('');
                setFromVerse(1);
                setToVerse('');
                setNote('');
                setStatus('passed');
                setRepeatCount(3);
              }}
              className="px-5 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold transition-all"
            >
              Nadiifi Foomka
            </button>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white text-xs font-black shadow-lg shadow-teal-600/30 transition-all active:scale-95 disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              <span>{submitting ? 'Waa la keydinayaa...' : 'Diiwaangeli Cashirka'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* ========================================================================= */}
      {/* 5. SEARCH & FILTER BAR (SCREEN ONLY) */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-slate-900 rounded-[28px] p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm print:hidden">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">

          {/* Search Bar */}
          <div className="relative flex-1">
            <input
              type="text"
              placeholder="Ka dhex raadi ardayga, suuradda, ama xusuusinta..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full px-4 py-3 pl-10 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
            />
            <Search size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
            {searchFilter && (
              <button onClick={() => setSearchFilter('')} className="absolute right-3 top-3 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Halaqah Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400">Xalaqadda:</span>
              <select
                value={halaqahFilter}
                onChange={(e) => setHalaqahFilter(e.target.value)}
                className="px-3 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="All">Dhammaan Xalaqooyinka</option>
                {uniqueHalaqahs.map(h => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>

            {/* Lesson Type Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400">Nooca:</span>
              <select
                value={lessonTypeFilter}
                onChange={(e) => setLessonTypeFilter(e.target.value)}
                className="px-3 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="All">Dhammaan Noocyada</option>
                {LESSON_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.labelSo}</option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-400">Natiijada:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="All">Dhammaan</option>
                <option value="passed">Gudbay ✓</option>
                <option value="repeat">Tikraar ↺</option>
              </select>
            </div>

            {/* Date Filter */}
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                className="px-3 py-2 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              {dateFilter && (
                <button
                  onClick={() => setDateFilter('')}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                  title="Nadiifi taariikhda"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 6. OFFICIAL PRINT HEADER (VISIBLE ONLY IN PRINT) */}
      {/* ========================================================================= */}
      <div className="hidden print:block mb-6 text-center space-y-2 border-b-2 border-slate-900 pb-4">
        <h2 className="text-base font-bold tracking-wider text-slate-800">
          CULUUMTA SHARECADA & CARABIGA EE SALAAX AL-DAAREYN
        </h2>
        <p className="text-xs font-medium text-slate-500 tracking-widest">ELASHA - SOMALIA</p>
        <div className="py-1">
          <h1 className="text-xl font-black text-slate-950 font-arabic">
            جدول الدروس اليومية للقرآن الكريم
          </h1>
          <p className="text-xs font-bold text-slate-700">
            JADWALKA CASHIRADA EE QUR'AANKA KARIIMKA
          </p>
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-600 px-4 pt-1">
          <span>Taariikhda: {new Date().toLocaleDateString('so-SO')}</span>
          <span>Wadarta Diiwaannada: {displayedRecords.length}</span>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 7. TABLE OF LESSON RECORDS */}
      {/* ========================================================================= */}
      <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-200/80 dark:border-slate-800 shadow-xl overflow-hidden print:border-none print:shadow-none">
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center text-teal-600 dark:text-teal-400">
              <Layers size={20} />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Diiwaanka Cashirada Maalinlaha ah
              </h3>
              <p className="text-xs text-slate-400">
                Wadarta {displayedRecords.length} cashir ayaa la helay
              </p>
            </div>
          </div>
        </div>

        {/* Table Content */}
        {displayedRecords.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
              <BookmarkCheck size={32} />
            </div>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              Wax cashir ah lama helin
            </p>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Ma jiraan diiwaanno ku habboon shaandhadaada ama weli cashir lama diiwaangelin.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/75 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400 print:bg-slate-100 print:text-black">
                  <th className="py-4 px-4 sm:px-6">#</th>
                  <th className="py-4 px-4 sm:px-6">Ardayga (الطالب)</th>
                  <th className="py-4 px-4 sm:px-6">Xalaqadda (الحلقة)</th>
                  <th className="py-4 px-4 sm:px-6">Suuradda & Aayadaha (السورة)</th>
                  <th className="py-4 px-4 sm:px-6">Nooca (النوع)</th>
                  <th className="py-4 px-4 sm:px-6">Natiijada (النتيجة)</th>
                  <th className="py-4 px-4 sm:px-6">Mulaaxado (الملاحظة)</th>
                  <th className="py-4 px-4 sm:px-6">Taariikhda (التاريخ)</th>
                  <th className="py-4 px-4 sm:px-6 text-right print:hidden">Ficil</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-semibold">
                {displayedRecords.map((record, index) => {
                  const typeObj = LESSON_TYPES.find(t => t.id === record.lessonType) || LESSON_TYPES[0];
                  return (
                    <tr
                      key={record._id}
                      className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors print:hover:bg-transparent"
                    >
                      {/* Index */}
                      <td className="py-4 px-4 sm:px-6 text-slate-400 font-bold">
                        {index + 1}
                      </td>

                      {/* Student Name */}
                      <td className="py-4 px-4 sm:px-6">
                        <div className="font-bold text-slate-900 dark:text-white text-sm">
                          {record.studentName}
                        </div>
                        {record.studentId?.rollNumber && (
                          <span className="text-[10px] text-slate-400">
                            Roll #{record.studentId.rollNumber}
                          </span>
                        )}
                      </td>

                      {/* Halaqah */}
                      <td className="py-4 px-4 sm:px-6 text-slate-600 dark:text-slate-300">
                        <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px]">
                          {record.halaqahName || '-'}
                        </span>
                      </td>

                      {/* Surah & Verses Range */}
                      <td className="py-4 px-4 sm:px-6">
                        <div className="font-bold text-slate-900 dark:text-white text-sm font-arabic">
                          {record.surahName}
                        </div>
                        <div className="text-[11px] text-teal-600 dark:text-teal-400 font-bold mt-0.5">
                          {record.toVerse ? `Aayadda ${record.fromVerse || 1} ilaa ${record.toVerse}` : `Aayadda ${record.fromVerse || 1}...`}
                        </div>
                      </td>

                      {/* Lesson Type */}
                      <td className="py-4 px-4 sm:px-6">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-[10px] font-black border ${typeObj.color}`}>
                          {typeObj.labelSo.split(' ')[0]}
                        </span>
                      </td>

                      {/* Status & Tikraar Badge */}
                      <td className="py-4 px-4 sm:px-6">
                        {record.status === 'passed' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 font-black text-xs">
                            <CheckCircle2 size={13} />
                            <span>Gudbay ✓</span>
                          </span>
                        ) : record.status === 'repeat' ? (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60 font-black text-xs">
                            <RotateCcw size={13} />
                            <span>Tikraar ({record.repeatCount || 1} jeer)</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60 font-black text-xs">
                            <Clock size={13} />
                            <span>Wadaa</span>
                          </span>
                        )}
                      </td>

                      {/* Note */}
                      <td className="py-4 px-4 sm:px-6 text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                        {record.note || '-'}
                      </td>

                      {/* Date */}
                      <td className="py-4 px-4 sm:px-6 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {record.date ? new Date(record.date).toLocaleDateString('so-SO') : '-'}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 sm:px-6 text-right print:hidden">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setEditingRecord({ ...record });
                              setIsEditModalOpen(true);
                            }}
                            className="p-2 rounded-xl text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-slate-800 transition-colors"
                            title="Wax ka beddel"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteRecord(record)}
                            className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 transition-colors"
                            title="Tirtir"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* 8. OFFICIAL PRINT SIGNATURE AREA (VISIBLE ONLY IN PRINT) */}
      {/* ========================================================================= */}
      <div className="hidden print:flex items-center justify-between pt-12 px-6 text-xs text-slate-700">
        <div className="text-center space-y-8">
          <p className="font-bold">Togiiqa Macallinka Cashirka</p>
          <div className="border-b border-slate-400 w-48" />
        </div>
        <div className="text-center space-y-8">
          <p className="font-bold">Shaabadda & Saxiixa Maamulka</p>
          <div className="border-b border-slate-400 w-48" />
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 9. EDIT MODAL (SCREEN ONLY) */}
      {/* ========================================================================= */}
      {isEditModalOpen && editingRecord && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] p-6 sm:p-8 max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-base font-black text-slate-900 dark:text-white flex items-center gap-2">
                <Edit2 size={18} className="text-teal-600" />
                <span>Wax ka beddel Cashirka</span>
              </h3>
              <button
                onClick={() => {
                  setIsEditModalOpen(false);
                  setEditingRecord(null);
                }}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateRecord} className="space-y-4">
              {/* Student Name */}
              <div>
                <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                  Ardayga
                </label>
                <input
                  type="text"
                  required
                  value={editingRecord.studentName}
                  onChange={(e) => setEditingRecord(prev => ({ ...prev, studentName: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold"
                />
              </div>

              {/* Halaqah */}
              <div>
                <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                  Xalaqadda / Fasalka
                </label>
                <input
                  type="text"
                  value={editingRecord.halaqahName || ''}
                  onChange={(e) => setEditingRecord(prev => ({ ...prev, halaqahName: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold"
                />
              </div>

              {/* Surah */}
              <div>
                <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                  Suuradda
                </label>
                <input
                  type="text"
                  required
                  value={editingRecord.surahName}
                  onChange={(e) => setEditingRecord(prev => ({ ...prev, surahName: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold font-arabic"
                />
              </div>

              {/* Verses Range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                    Laga bilaabo
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editingRecord.fromVerse || 1}
                    onChange={(e) => setEditingRecord(prev => ({ ...prev, fromVerse: Number(e.target.value) || 1 }))}
                    className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                    Ilaa Aayadda
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editingRecord.toVerse || ''}
                    onChange={(e) => setEditingRecord(prev => ({ ...prev, toVerse: e.target.value ? Number(e.target.value) : undefined }))}
                    className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold"
                  />
                </div>
              </div>

              {/* Lesson Type & Status */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                    Nooca
                  </label>
                  <select
                    value={editingRecord.lessonType || 'sabaq'}
                    onChange={(e) => setEditingRecord(prev => ({ ...prev, lessonType: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                  >
                    {LESSON_TYPES.map(t => (
                      <option key={t.id} value={t.id}>{t.labelSo}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                    Natiijada
                  </label>
                  <select
                    value={editingRecord.status}
                    onChange={(e) => setEditingRecord(prev => ({ ...prev, status: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold"
                  >
                    <option value="passed">Gudbay ✓</option>
                    <option value="repeat">Tikraar ↺</option>
                  </select>
                </div>
              </div>

              {/* Tikraar Count */}
              {editingRecord.status === 'repeat' && (
                <div>
                  <label className="block text-[11px] font-black uppercase text-amber-700 dark:text-amber-400 mb-1">
                    Tirada Tikraarka
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={editingRecord.repeatCount || 1}
                    onChange={(e) => setEditingRecord(prev => ({ ...prev, repeatCount: Math.max(1, parseInt(e.target.value) || 1) }))}
                    className="w-full px-4 py-2.5 rounded-2xl bg-amber-50 dark:bg-slate-800 border border-amber-300 dark:border-slate-700 text-sm font-black text-amber-900 dark:text-amber-300"
                  />
                </div>
              )}

              {/* Note */}
              <div>
                <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                  Mulaaxadada Macallinka
                </label>
                <input
                  type="text"
                  value={editingRecord.note || ''}
                  onChange={(e) => setEditingRecord(prev => ({ ...prev, note: e.target.value }))}
                  className="w-full px-4 py-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-medium"
                />
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditModalOpen(false);
                    setEditingRecord(null);
                  }}
                  className="px-4 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400"
                >
                  Ka noqo
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-6 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black shadow-lg shadow-teal-600/30"
                >
                  {submitting ? 'Waa la keydinayaa...' : 'Kaydi Isbeddelka'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

export default QuranLessonManagement;
