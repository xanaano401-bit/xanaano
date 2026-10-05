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
  Building2,
  Users,
  CheckSquare,
  Sliders,
  Settings,
  Save,
  Check,
  ArrowRight
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
  // Navigation tab: 'class_sheet' (primary) | 'records_history'
  const [activeTab, setActiveTab] = useState('class_sheet');

  // Branch states
  const [branches, setBranches] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');

  // General Data states
  const [records, setRecords] = useState([]);
  const [students, setStudents] = useState([]);
  const [classes, setClasses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  // ==========================================
  // CLASS SHEET STATES (Batch grading & Auto-progression)
  // ==========================================
  const [sheetClassId, setSheetClassId] = useState('');
  const [sheetDate, setSheetDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sheetStudents, setSheetStudents] = useState([]);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetSaving, setSheetSaving] = useState(false);

  // Modal for editing single student's Quran starting point (Bisinka & Aayadda)
  const [progressModalStudent, setProgressModalStudent] = useState(null);
  const [progressModalSurahNum, setProgressModalSurahNum] = useState(1);
  const [progressModalFromVerse, setProgressModalFromVerse] = useState(1);
  const [progressModalDailyPace, setProgressModalDailyPace] = useState(5);
  const [progressModalSaving, setProgressModalSaving] = useState(false);

  // Form states (single manual entry)
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

  const [status, setStatus] = useState('passed');
  const [repeatCount, setRepeatCount] = useState(3);
  const [note, setNote] = useState('');
  const [recordDate, setRecordDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Edit modal state (history table)
  const [editingRecord, setEditingRecord] = useState(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Filters for History table
  const [searchFilter, setSearchFilter] = useState('');
  const [halaqahFilter, setHalaqahFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [lessonTypeFilter, setLessonTypeFilter] = useState('All');
  const [dateFilter, setDateFilter] = useState('');

  // Refs for click outside
  const studentDropdownRef = useRef(null);
  const surahDropdownRef = useRef(null);
  const surahInputRef = useRef(null);

  // Fetch initial base data
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
      const classList = classesRes.data || [];
      setBranches(branchList);
      setRecords(lessonsRes.data || []);
      setStudents(studentsRes.data || []);
      setClasses(classList);

      if (!selectedBranchId && branchList.length > 0) {
        const dugsiBranch = branchList.find(b => b.name && b.name.toLowerCase().includes('dugsi'));
        const defaultBranchId = dugsiBranch ? dugsiBranch._id : branchList[0]._id;
        setSelectedBranchId(defaultBranchId);

        // Pre-select first class of default branch
        const firstClass = classList.find(c => String(c.branchId?._id || c.branchId) === String(defaultBranchId));
        if (firstClass && !sheetClassId) {
          setSheetClassId(firstClass._id);
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

  // Filter classes based on branch
  const branchClasses = useMemo(() => {
    if (!selectedBranchId || selectedBranchId === 'ALL' || selectedBranchId === 'All') return classes;
    return classes.filter(c => {
      const bId = String(c.branchId?._id || c.branchId || '');
      return bId === String(selectedBranchId);
    });
  }, [classes, selectedBranchId]);

  // When branchClasses updates and current sheetClassId is not in it, reset to first class
  useEffect(() => {
    if (branchClasses.length > 0) {
      const exists = branchClasses.some(c => String(c._id) === String(sheetClassId));
      if (!exists) {
        setSheetClassId(branchClasses[0]._id);
      }
    } else {
      setSheetClassId('');
      setSheetStudents([]);
    }
  }, [branchClasses]);

  // Load Class Quran Sheet whenever sheetClassId or sheetDate changes
  const loadClassSheet = async (targetClassId = sheetClassId, targetDate = sheetDate) => {
    if (!targetClassId) {
      setSheetStudents([]);
      return;
    }

    try {
      setSheetLoading(true);
      const res = await api.get('/quran/lessons/class-sheet', {
        params: { classId: targetClassId, date: targetDate }
      });

      const list = (res.data.students || []).map(s => {
        const hasToday = !!s.todayRecord;
        return {
          studentId: s.studentId,
          fullName: s.fullName,
          rollNumber: s.rollNumber,
          studentCode: s.studentCode,
          quranProgress: s.quranProgress,
          surahNumber: hasToday ? s.todayRecord.surahNumber || s.scheduledLesson.surahNumber : s.scheduledLesson.surahNumber,
          surahName: hasToday ? s.todayRecord.surahName : s.scheduledLesson.surahName,
          fromVerse: hasToday ? s.todayRecord.fromVerse : s.scheduledLesson.fromVerse,
          toVerse: hasToday ? s.todayRecord.toVerse : s.scheduledLesson.toVerse,
          maxVerses: s.scheduledLesson.maxVerses,
          status: hasToday ? s.todayRecord.status : 'passed', // default to passed
          note: hasToday ? (s.todayRecord.note || '') : '',
          lessonType: 'sabaq',
          isSavedToday: hasToday
        };
      });

      setSheetStudents(list);
    } catch (err) {
      console.error('Error fetching class Quran sheet:', err);
      setMessage({ type: 'error', text: 'Ma suurtogalin in la soo qaado xaashida fasalka.' });
    } finally {
      setSheetLoading(false);
    }
  };

  useEffect(() => {
    if (sheetClassId) {
      loadClassSheet(sheetClassId, sheetDate);
    }
  }, [sheetClassId, sheetDate]);

  // Batch toggle all students in sheet to passed or repeat
  const handleMarkAllStudents = (newStatus) => {
    setSheetStudents(prev => prev.map(s => ({
      ...s,
      status: newStatus
    })));
  };

  // Toggle single student status between 'passed' and 'repeat'
  const handleToggleStudentStatus = (studentId, statusValue) => {
    setSheetStudents(prev => prev.map(s => {
      if (s.studentId === studentId) {
        return { ...s, status: statusValue };
      }
      return s;
    }));
  };

  // Update verse range or note for a student in sheet
  const handleUpdateSheetField = (studentId, field, value) => {
    setSheetStudents(prev => prev.map(s => {
      if (s.studentId === studentId) {
        return { ...s, [field]: value };
      }
      return s;
    }));
  };

  // Open modal to configure student's starting point (Bisinka & Aayadda)
  const handleOpenProgressModal = (studentItem) => {
    setProgressModalStudent(studentItem);
    setProgressModalSurahNum(studentItem.quranProgress?.surahNumber || studentItem.surahNumber || 1);
    setProgressModalFromVerse(studentItem.quranProgress?.fromVerse || studentItem.fromVerse || 1);
    setProgressModalDailyPace(studentItem.quranProgress?.dailyPace || 5);
  };

  // Save student's starting point
  const handleSaveProgressModal = async (e) => {
    e.preventDefault();
    if (!progressModalStudent) return;

    try {
      setProgressModalSaving(true);
      const res = await api.put(`/quran/lessons/progress/${progressModalStudent.studentId}`, {
        surahNumber: progressModalSurahNum,
        fromVerse: progressModalFromVerse,
        dailyPace: progressModalDailyPace
      });

      const updatedProgress = res.data.quranProgress;
      const surahObj = QURAN_SURAHS.find(s => s.number === Number(progressModalSurahNum)) || QURAN_SURAHS[0];
      const maxV = surahObj.verses || 100;
      const fromV = Math.max(1, Math.min(Number(progressModalFromVerse) || 1, maxV));
      const pace = Number(progressModalDailyPace) || 5;
      const toV = Math.min(maxV, fromV + (pace - 1));

      // Update student row in current sheet
      setSheetStudents(prev => prev.map(s => {
        if (s.studentId === progressModalStudent.studentId) {
          return {
            ...s,
            quranProgress: {
              ...s.quranProgress,
              surahNumber: progressModalSurahNum,
              surahName: surahObj.nameSo || surahObj.nameAr,
              fromVerse: fromV,
              dailyPace: pace,
              maxVerses: maxV
            },
            surahNumber: progressModalSurahNum,
            surahName: `${surahObj.number}. ${surahObj.nameAr} (${surahObj.nameSo})`,
            fromVerse: fromV,
            toVerse: toV,
            maxVerses: maxV
          };
        }
        return s;
      }));

      setMessage({
        type: 'success',
        text: `Si guul leh ayaa loo habeeyey bilowga ardayga "${progressModalStudent.fullName}" (${surahObj.nameSo}, Aayad: ${fromV}, Xawaare: ${pace})!`
      });

      setProgressModalStudent(null);
    } catch (err) {
      console.error('Error updating student Quran progress:', err);
      setMessage({ type: 'error', text: 'Khalad ayaa dhacay markii bilowga ardayga la keydinayay.' });
    } finally {
      setProgressModalSaving(false);
    }
  };

  // Submit the entire class sheet in batch
  const handleSaveClassSheet = async () => {
    if (!sheetClassId) {
      setMessage({ type: 'error', text: 'Fadlan dooro fasal.' });
      return;
    }

    if (sheetStudents.length === 0) {
      setMessage({ type: 'error', text: 'Fasalkaan arday kuma jirto.' });
      return;
    }

    try {
      setSheetSaving(true);
      setMessage(null);

      const payload = {
        classId: sheetClassId,
        branchId: selectedBranchId && selectedBranchId !== 'ALL' ? selectedBranchId : undefined,
        date: sheetDate,
        lessons: sheetStudents.map(s => ({
          studentId: s.studentId,
          surahNumber: s.surahNumber,
          surahName: s.surahName,
          fromVerse: Number(s.fromVerse) || 1,
          toVerse: Number(s.toVerse) || Number(s.fromVerse) || 1,
          status: s.status || 'passed',
          note: s.note || '',
          lessonType: s.lessonType || 'sabaq'
        }))
      };

      const res = await api.post('/quran/lessons/batch', payload);

      const passedCount = sheetStudents.filter(s => s.status === 'passed').length;
      const repeatCount = sheetStudents.filter(s => s.status === 'repeat').length;

      setMessage({
        type: 'success',
        text: `Si guul leh ayaa loo keydiyey xaashida maanta! (${passedCount} Gudbay - si toos ah ayey aayaduhu ugu kordheen, ${repeatCount} Tikraar - halkoodii ayey ku nagaadeen).`
      });

      // Reload class sheet and global records
      await Promise.all([
        loadClassSheet(sheetClassId, sheetDate),
        api.get('/quran/lessons').then(r => setRecords(r.data || [])).catch(() => {})
      ]);
    } catch (err) {
      console.error('Error saving class Quran sheet:', err);
      setMessage({ type: 'error', text: err.response?.data?.message || 'Khalad ayaa dhacay markii xaashida la keydinayay.' });
    } finally {
      setSheetSaving(false);
    }
  };

  // ==========================================
  // SINGLE MANUAL ENTRY & FILTER LOGIC
  // ==========================================
  const branchStudents = useMemo(() => {
    if (!selectedBranchId || selectedBranchId === 'ALL' || selectedBranchId === 'All') return students;
    return students.filter(s => {
      const sBranchId = String(s.branchId?._id || s.branchId || '');
      const cBranchId = String(s.classId?.branchId?._id || s.classId?.branchId || '');
      const target = String(selectedBranchId);
      return sBranchId === target || cBranchId === target;
    });
  }, [students, selectedBranchId]);

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

    // Pre-populate with student's current Quran progress if available
    if (student.quranProgress) {
      const sNum = student.quranProgress.surahNumber || 1;
      const surahObj = QURAN_SURAHS.find(s => s.number === sNum) || QURAN_SURAHS[0];
      setSelectedSurah(surahObj);
      setSurahSearchQuery(`${surahObj.number}. ${surahObj.nameAr} (${surahObj.nameSo})`);
      setFromVerse(student.quranProgress.fromVerse || 1);
      const pace = student.quranProgress.dailyPace || 5;
      setToVerse(Math.min(surahObj.verses, (student.quranProgress.fromVerse || 1) + pace - 1));
    } else {
      setSelectedSurah(null);
      setSurahSearchQuery('');
      setFromVerse(1);
      setToVerse('');
    }

    setNote('');
    setStatus('passed');
    setRepeatCount(3);
    setTimeout(() => {
      if (surahInputRef.current) surahInputRef.current.focus();
    }, 50);
  };

  const handleSelectSurah = (surah) => {
    setSelectedSurah(surah);
    setSurahSearchQuery(`${surah.number}. ${surah.nameAr} (${surah.nameSo})`);
    setIsSurahDropdownOpen(false);
    if (!toVerse || Number(toVerse) > surah.verses) {
      setToVerse(Math.min(surah.verses, 10));
    }
  };

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

  // PDF Export
  const handleExportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(15, 23, 42);
    doc.text('CULUUMTA SHARECADA & CARABIGA EE SALAAX AL-DAAREYN', pageWidth / 2, 16, { align: 'center' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('ELASHA - SOMALIA', pageWidth / 2, 22, { align: 'center' });

    doc.setDrawColor(203, 213, 225);
    doc.setLineWidth(0.5);
    doc.line(15, 25, pageWidth - 15, 25);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(5, 150, 105);
    doc.text('JADWALKA CASHIRADA EE QUR\'AANKA KARIIMKA', pageWidth / 2, 33, { align: 'center' });

    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(`Taariikhda: ${new Date().toLocaleDateString('so-SO')}`, 15, 45);
    doc.text(`Wadarta Diiwaannada: ${displayedRecords.length}`, pageWidth - 15, 45, { align: 'right' });

    const startY = 49;
    const colX = { num: 15, name: 24, halaqah: 72, surah: 104, range: 135, type: 155, status: 175 };

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
      doc.text(String(idx + 1), colX.num + 2, curY + 4.8);
      doc.setTextColor(15, 23, 42);
      doc.text((r.studentName || '-').slice(0, 24), colX.name, curY + 4.8);
      doc.setTextColor(71, 85, 105);
      doc.text((r.halaqahName || '-').slice(0, 16), colX.halaqah, curY + 4.8);
      doc.text((r.surahName || '-').slice(0, 18), colX.surah, curY + 4.8);
      doc.text(r.toVerse ? `${r.fromVerse || 1}-${r.toVerse}` : `${r.fromVerse || 1}`, colX.range, curY + 4.8);
      doc.text(r.lessonType || 'sabaq', colX.type, curY + 4.8);

      if (r.status === 'passed') {
        doc.setTextColor(5, 150, 105);
        doc.text('Gudbay', colX.status, curY + 4.8);
      } else {
        doc.setTextColor(217, 119, 6);
        doc.text('Tikraar', colX.status, curY + 4.8);
      }
      curY += 7;
    });

    doc.save(`Jadwalka_Cashirada_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // Sheet counts
  const sheetStats = useMemo(() => {
    const total = sheetStudents.length;
    const passed = sheetStudents.filter(s => s.status === 'passed').length;
    const repeat = sheetStudents.filter(s => s.status === 'repeat').length;
    return { total, passed, repeat };
  }, [sheetStudents]);

  return (
    <div className="space-y-6 pb-20 max-w-[1600px] mx-auto animate-in fade-in duration-500">

      {/* ========================================================================= */}
      {/* 1. TOP HEADER BANNER (SCREEN ONLY) */}
      {/* ========================================================================= */}
      <div className="relative overflow-hidden rounded-[32px] bg-gradient-to-br from-slate-900 via-teal-950 to-slate-900 border border-teal-500/20 shadow-2xl p-6 sm:p-8 print:hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-300 text-xs font-semibold backdrop-blur-md">
              <Sparkles size={14} className="text-teal-300" />
              <span>Dugsi & Xalaqooyinka Quraanka Kariimka</span>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-teal-500 to-emerald-400 flex items-center justify-center shadow-lg shadow-teal-500/30">
                <BookmarkCheck size={26} className="text-slate-950 stroke-[2.5]" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-white flex items-center gap-3">
                  <span>Jadwalka Cashirada & Sabaqa</span>
                  <span className="text-xl sm:text-2xl text-teal-300 font-arabic font-normal">(جدول الدروس اليومية)</span>
                </h1>
                <p className="text-teal-100/80 text-sm mt-0.5">
                  Qiimeynta tooska ah ee fasalka, xisaabinta aayadaha automatic-ka ah, & diiwaanka guud
                </p>
              </div>
            </div>
          </div>

          {/* Quick Action Buttons & Branch Selection */}
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
              <span>Daabac</span>
            </button>

            <button
              onClick={handleExportPDF}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-black transition-all shadow-lg shadow-teal-500/30 active:scale-95"
            >
              <FileDown size={16} />
              <span>Soo Deji PDF</span>
            </button>

            <button
              onClick={() => {
                fetchData();
                if (sheetClassId) loadClassSheet(sheetClassId, sheetDate);
              }}
              disabled={loading || sheetLoading}
              className="p-3 rounded-2xl bg-white/10 hover:bg-white/20 text-white transition-all border border-white/10 active:scale-95"
              title="Dib-u-cusboonaysii"
            >
              <RefreshCw size={16} className={loading || sheetLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* TAB SWITCHER */}
        {/* ========================================================================= */}
        <div className="mt-8 pt-4 border-t border-teal-500/20 flex flex-wrap items-center gap-3">
          <button
            onClick={() => setActiveTab('class_sheet')}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-xs transition-all ${
              activeTab === 'class_sheet'
                ? 'bg-teal-500 text-slate-950 shadow-lg shadow-teal-500/40 scale-105'
                : 'bg-white/5 hover:bg-white/10 text-teal-200 border border-teal-500/20'
            }`}
          >
            <Users size={16} />
            <span>Xaashida Fasalka (Class Daily Sheet)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-950/20 font-black">
              Toos & Automatic
            </span>
          </button>

          <button
            onClick={() => setActiveTab('records_history')}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-black text-xs transition-all ${
              activeTab === 'records_history'
                ? 'bg-teal-500 text-slate-950 shadow-lg shadow-teal-500/40 scale-105'
                : 'bg-white/5 hover:bg-white/10 text-teal-200 border border-teal-500/20'
            }`}
          >
            <BookOpen size={16} />
            <span>Diiwaanka Guud & Taariikhda (History & Single Entry)</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-950/20 font-black">
              {records.length}
            </span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* NOTIFICATION MESSAGE */}
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
      {/* TAB 1: XAASHIDA FASALKA (CLASS DAILY SHEET WITH AUTO-PROGRESSION) */}
      {/* ========================================================================= */}
      {activeTab === 'class_sheet' && (
        <div className="space-y-6">

          {/* Class & Date Selector Card */}
          <div className="bg-white dark:bg-slate-900 rounded-[32px] p-6 sm:p-7 border border-slate-200/80 dark:border-slate-800 shadow-xl">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-5">
              {/* Class & Date Dropdowns */}
              <div className="flex flex-wrap items-center gap-4 flex-1">
                {/* Select Class */}
                <div className="flex-1 min-w-[240px]">
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Users size={14} className="text-teal-600" />
                    <span>Dooro Fasalka / Xalaqadda (الفصل / الحلقة) *</span>
                  </label>
                  <select
                    value={sheetClassId}
                    onChange={(e) => setSheetClassId(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all cursor-pointer"
                  >
                    <option value="">-- Dooro Fasal ama Xalaqo --</option>
                    {branchClasses.map(c => (
                      <option key={c._id} value={c._id}>
                        {c.name || c.className}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Date Picker */}
                <div className="w-full sm:w-auto">
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center gap-1.5">
                    <Calendar size={14} className="text-teal-600" />
                    <span>Taariikhda Cashirka (التاريخ)</span>
                  </label>
                  <input
                    type="date"
                    value={sheetDate}
                    onChange={(e) => setSheetDate(e.target.value)}
                    className="w-full sm:w-48 px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all cursor-pointer"
                  />
                </div>
              </div>

              {/* Batch Action Buttons */}
              {sheetStudents.length > 0 && (
                <div className="flex flex-wrap items-center gap-2.5 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => handleMarkAllStudents('passed')}
                    className="px-4 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-emerald-600/30 transition-all active:scale-95"
                    title="Dhammaan ardayda u calaamadee 'Gudbay'"
                  >
                    <CheckCircle2 size={16} />
                    <span>Dhammaan Gudbi ✓</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleMarkAllStudents('repeat')}
                    className="px-4 py-2.5 rounded-2xl bg-amber-600 hover:bg-amber-500 text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-600/30 transition-all active:scale-95"
                    title="Dhammaan ardayda u calaamadee 'Tikraar'"
                  >
                    <RotateCcw size={16} />
                    <span>Dhammaan Tikraar ↺</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSaveClassSheet}
                    disabled={sheetSaving}
                    className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-black text-xs flex items-center gap-2 shadow-lg shadow-teal-600/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Save size={16} />
                    <span>{sheetSaving ? 'Waa la keydinayaa...' : 'Keydi Xaashida Maanta'}</span>
                  </button>
                </div>
              )}
            </div>

            {/* Quick Helper Banner */}
            <div className="mt-4 p-3.5 rounded-2xl bg-teal-50/70 dark:bg-teal-950/20 border border-teal-200/70 dark:border-teal-900/40 flex items-center justify-between flex-wrap gap-2 text-xs">
              <div className="flex items-center gap-2 text-teal-900 dark:text-teal-200 font-semibold">
                <Sparkles size={16} className="text-teal-600 shrink-0" />
                <span>
                  <strong>Nidaamka Automatic-ka ah:</strong> Markaad doorato <strong>"Gudbay ✓"</strong> ardaygu si toos ah ayuu hore ugu soconayaa aayadaha xaddigiisa maalinlaha ah. Haddii aad doorato <strong>"Tikraar ↺"</strong> bisinkiisa iyo aayaddiisu kama dhaqaaqayaan!
                </span>
              </div>
              {sheetStudents.length > 0 && (
                <div className="flex items-center gap-3 font-black text-xs shrink-0">
                  <span className="text-slate-600 dark:text-slate-400">Ardayda: {sheetStats.total}</span>
                  <span className="text-emerald-600 dark:text-emerald-400">Gudbay: {sheetStats.passed}</span>
                  <span className="text-amber-600 dark:text-amber-400">Tikraar: {sheetStats.repeat}</span>
                </div>
              )}
            </div>
          </div>

          {/* Interactive Class Sheet Table */}
          <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-200/80 dark:border-slate-800 shadow-xl overflow-hidden">
            {sheetLoading ? (
              <div className="p-16 text-center space-y-3">
                <RefreshCw size={36} className="animate-spin text-teal-600 mx-auto" />
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  Waxaa la soo qaadayaa ardayda fasalka iyo cashiradooda maanta...
                </p>
              </div>
            ) : !sheetClassId ? (
              <div className="p-16 text-center space-y-3">
                <div className="w-16 h-16 rounded-3xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center mx-auto text-teal-600">
                  <Users size={32} />
                </div>
                <p className="text-base font-black text-slate-800 dark:text-white">
                  Fadlan kor ka dooro Fasalka ama Xalaqadda
                </p>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Markaad doorato fasalka, dhammaan ardayda waxay kuugu soo bixi doonaan hal xaashi oo aad hal mar ku wada gudbin karto ama tikraar ugu diri karto.
                </p>
              </div>
            ) : sheetStudents.length === 0 ? (
              <div className="p-16 text-center space-y-3">
                <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <BookmarkCheck size={32} />
                </div>
                <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                  Fasalkaan arday firfircoon laguma helin
                </p>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Hubi in arday lagu daray fasalkaan bogga Maamulka Ardayda (Students Management).
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/75 dark:bg-slate-800/50 border-b border-slate-200/80 dark:border-slate-800 text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-400">
                      <th className="py-4 px-4 sm:px-6">#</th>
                      <th className="py-4 px-4 sm:px-6">Ardayga (الطالب)</th>
                      <th className="py-4 px-4 sm:px-6">Bisinka & Bilowga (Starting Point)</th>
                      <th className="py-4 px-4 sm:px-6">Cashirka Maanta (Aayadaha)</th>
                      <th className="py-4 px-4 sm:px-6 text-center">Natiijada Maanta (Status)</th>
                      <th className="py-4 px-4 sm:px-6">Mulaaxado (Note)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs font-semibold">
                    {sheetStudents.map((item, index) => {
                      const isPassed = item.status === 'passed';
                      const isRepeat = item.status === 'repeat';

                      return (
                        <tr
                          key={item.studentId}
                          className={`transition-colors ${
                            isRepeat
                              ? 'bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/70'
                              : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          {/* Row Index */}
                          <td className="py-4 px-4 sm:px-6 text-slate-400 font-bold">
                            {index + 1}
                          </td>

                          {/* Student Info */}
                          <td className="py-4 px-4 sm:px-6">
                            <div className="font-bold text-slate-900 dark:text-white text-sm">
                              {item.fullName}
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {item.rollNumber && (
                                <span className="text-[10px] text-teal-600 dark:text-teal-400 font-bold">
                                  Roll #{item.rollNumber}
                                </span>
                              )}
                              {item.isSavedToday && (
                                <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                                  Waa la keydiyey
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Starting Point & Progress Badge with Edit Button */}
                          <td className="py-4 px-4 sm:px-6">
                            <div className="flex items-center gap-2">
                              <div className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5">
                                <p className="font-bold text-slate-900 dark:text-white text-xs font-arabic">
                                  {item.quranProgress?.surahNumber}. {item.quranProgress?.nameSo || item.quranProgress?.surahName}
                                </p>
                                <p className="text-[10px] text-teal-600 dark:text-teal-400 font-bold">
                                  Aayad: {item.quranProgress?.fromVerse || 1} • Xawaare: {item.quranProgress?.dailyPace || 5} aayad
                                </p>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleOpenProgressModal(item)}
                                className="p-2 rounded-xl text-slate-400 hover:text-teal-600 hover:bg-teal-50 dark:hover:bg-slate-800 transition-colors"
                                title="Habee meesha ardaygu ka bilaabayo (Bisinka, Aayadda, Xawaaraha)"
                              >
                                <Settings size={16} />
                              </button>
                            </div>
                          </td>

                          {/* Today's Scheduled Lesson (Surah & Verses) */}
                          <td className="py-4 px-4 sm:px-6">
                            <div className="space-y-1.5">
                              <span className="font-black text-slate-800 dark:text-white text-xs font-arabic block">
                                {item.surahName}
                              </span>
                              <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-[11px] text-slate-400 font-bold">Aayadaha:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max={item.maxVerses || 286}
                                  value={item.fromVerse}
                                  onChange={(e) => handleUpdateSheetField(item.studentId, 'fromVerse', Number(e.target.value) || 1)}
                                  className="w-14 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                />
                                <span className="text-slate-400 font-bold">-</span>
                                <input
                                  type="number"
                                  min="1"
                                  max={item.maxVerses || 286}
                                  value={item.toVerse}
                                  onChange={(e) => handleUpdateSheetField(item.studentId, 'toVerse', Number(e.target.value) || 1)}
                                  className="w-14 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                />
                              </div>
                            </div>
                          </td>

                          {/* Quick Interactive Status Toggle: Gudbay vs Tikraar */}
                          <td className="py-4 px-4 sm:px-6 text-center">
                            <div className="inline-flex items-center gap-1.5 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700">
                              <button
                                type="button"
                                onClick={() => handleToggleStudentStatus(item.studentId, 'passed')}
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                                  isPassed
                                    ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30 scale-105'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-emerald-600'
                                }`}
                              >
                                <CheckCircle2 size={15} />
                                <span>Gudbay ✓</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleToggleStudentStatus(item.studentId, 'repeat')}
                                className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 ${
                                  isRepeat
                                    ? 'bg-amber-600 text-white shadow-md shadow-amber-600/30 scale-105'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-amber-600'
                                }`}
                              >
                                <RotateCcw size={15} />
                                <span>Tikraar ↺</span>
                              </button>
                            </div>
                          </td>

                          {/* Note Field */}
                          <td className="py-4 px-4 sm:px-6">
                            <input
                              type="text"
                              placeholder="Xusuusin..."
                              value={item.note || ''}
                              onChange={(e) => handleUpdateSheetField(item.studentId, 'note', e.target.value)}
                              className="w-full min-w-[150px] px-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Bottom Save Bar */}
            {sheetStudents.length > 0 && (
              <div className="p-5 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-500 font-bold">
                  Waxaad qiimeysay <strong className="text-slate-900 dark:text-white">{sheetStudents.length}</strong> arday:{' '}
                  <span className="text-emerald-600 font-black">{sheetStats.passed} Gudbay</span>,{' '}
                  <span className="text-amber-600 font-black">{sheetStats.repeat} Tikraar</span>.
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleSaveClassSheet}
                    disabled={sheetSaving}
                    className="w-full sm:w-auto px-8 py-3 rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white font-black text-xs flex items-center justify-center gap-2 shadow-xl shadow-teal-600/30 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Save size={16} />
                    <span>{sheetSaving ? 'Waa la keydinayaa...' : 'Keydi Dhammaan Cashirada Fasalka'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: DIIWAANKA GUUD & TAARIIKHDA (HISTORY & SINGLE MANUAL ENTRY) */}
      {/* ========================================================================= */}
      {activeTab === 'records_history' && (
        <div className="space-y-6">

          {/* Stats Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 print:hidden">
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm">
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

            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-emerald-100 dark:border-emerald-950/60 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Gudbay (Passed)</p>
                <div className="w-9 h-9 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={18} />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-emerald-600 dark:text-emerald-400 mt-2">
                {stats.passed}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">Si fiican u akhriyey</p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-amber-100 dark:border-amber-950/60 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">Tikraar (Repeat)</p>
                <div className="w-9 h-9 rounded-2xl bg-amber-50 dark:bg-amber-950/50 flex items-center justify-center text-amber-600 dark:text-amber-400">
                  <RotateCcw size={18} />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-amber-600 dark:text-amber-400 mt-2">
                {stats.repeat}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">U baahan ku celcelin</p>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Ardayda Leh Cashir</p>
                <div className="w-9 h-9 rounded-2xl bg-blue-50 dark:bg-blue-950/50 flex items-center justify-center text-blue-600 dark:text-blue-400">
                  <UserCheck size={18} />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white mt-2">
                {stats.uniqueStudents}
              </p>
              <p className="text-[11px] text-slate-400 mt-1">Arday firfircoon</p>
            </div>

            <div className="col-span-2 lg:col-span-1 bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400">Heerka Guusha</p>
                <div className="w-9 h-9 rounded-2xl bg-teal-50 dark:bg-teal-950/50 flex items-center justify-center text-teal-600 dark:text-teal-400">
                  <Award size={18} />
                </div>
              </div>
              <p className="text-2xl sm:text-3xl font-black text-teal-600 dark:text-teal-400 mt-2">
                {stats.passRate}%
              </p>
              <p className="text-[11px] text-slate-400 mt-1">Heerka gudbista</p>
            </div>
          </div>

          {/* Single Manual Entry Form */}
          <div className="bg-white dark:bg-slate-900 rounded-[32px] p-6 sm:p-8 border border-slate-200/80 dark:border-slate-800 shadow-xl print:hidden">
            <div className="flex items-center justify-between mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h2 className="text-lg sm:text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                  <Plus className="text-teal-600" size={20} />
                  <span>Diiwaangeli Cashir Gooni ah (Single Entry)</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  U isticmaal diiwaangelinta arday gooni ah oo cashir gaar ah qaadanaya.
                </p>
              </div>
              <span className="text-[11px] font-bold px-3 py-1 rounded-full bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800">
                Foomka Goonida ah
              </span>
            </div>

            <form onSubmit={handleSubmitRecord} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Field 1: Dooro Ardayga */}
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

                {/* Field 2: Fasalka */}
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    2. Xalaqadda / Fasalka (الحلقة)
                  </label>
                  <input
                    type="text"
                    placeholder="Xalaqadda ardayga..."
                    value={halaqahName}
                    onChange={(e) => setHalaqahName(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                  />
                </div>

                {/* Field 3: Dooro Suuradda */}
                <div className="relative" ref={surahDropdownRef}>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                    <span>3. Suuradda (السورة) *</span>
                    {selectedSurah && (
                      <span className="text-[10px] text-teal-600 dark:text-teal-400 font-bold">
                        {selectedSurah.verses} aayadood
                      </span>
                    )}
                  </label>
                  <div className="relative">
                    <input
                      ref={surahInputRef}
                      type="text"
                      required
                      placeholder="Dooro suuradda (1-114)..."
                      value={surahSearchQuery}
                      onChange={(e) => {
                        setSurahSearchQuery(e.target.value);
                        setIsSurahDropdownOpen(true);
                      }}
                      onFocus={() => setIsSurahDropdownOpen(true)}
                      className="w-full px-4 py-3 pl-10 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                    />
                    <BookOpen size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
                  </div>

                  {isSurahDropdownOpen && filteredSurahs.length > 0 && (
                    <div className="absolute z-30 left-0 right-0 mt-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                      {filteredSurahs.map((surah) => (
                        <div
                          key={surah.number}
                          onClick={() => handleSelectSurah(surah)}
                          className="p-2.5 px-3.5 hover:bg-teal-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            <span className="w-7 h-7 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 text-xs font-black flex items-center justify-center">
                              {surah.number}
                            </span>
                            <div>
                              <p className="text-sm font-bold text-slate-900 dark:text-white">
                                {surah.number}. {surah.nameSo}
                              </p>
                              <p className="text-[11px] text-slate-400">{surah.verses} aayadood</p>
                            </div>
                          </div>
                          <span className="text-sm font-arabic font-bold text-teal-600 dark:text-teal-400">
                            {surah.nameAr}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Field 4: Taariikhda */}
                <div>
                  <label className="block text-[11px] font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
                    4. Taariikhda (التاريخ)
                  </label>
                  <input
                    type="date"
                    value={recordDate}
                    onChange={(e) => setRecordDate(e.target.value)}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all"
                  />
                </div>
              </div>

              {/* Row 2: Aayadaha Range & Nooca Cashirka */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 pt-1">
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

              {/* Row 3: Note & Quick Chips */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 pt-1">
                <div className="lg:col-span-3 space-y-2">
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

          {/* Search & Filter Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-[28px] p-5 border border-slate-200/80 dark:border-slate-800 shadow-sm print:hidden">
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
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

              <div className="flex flex-wrap items-center gap-3">
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

          {/* History Records Table */}
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
                          <td className="py-4 px-4 sm:px-6 text-slate-400 font-bold">
                            {index + 1}
                          </td>

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

                          <td className="py-4 px-4 sm:px-6 text-slate-600 dark:text-slate-300">
                            <span className="px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px]">
                              {record.halaqahName || '-'}
                            </span>
                          </td>

                          <td className="py-4 px-4 sm:px-6">
                            <div className="font-bold text-slate-900 dark:text-white text-sm font-arabic">
                              {record.surahName}
                            </div>
                            <div className="text-[11px] text-teal-600 dark:text-teal-400 font-bold mt-0.5">
                              {record.toVerse ? `Aayadda ${record.fromVerse || 1} ilaa ${record.toVerse}` : `Aayadda ${record.fromVerse || 1}...`}
                            </div>
                          </td>

                          <td className="py-4 px-4 sm:px-6">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-xl text-[10px] font-black border ${typeObj.color}`}>
                              {typeObj.labelSo.split(' ')[0]}
                            </span>
                          </td>

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

                          <td className="py-4 px-4 sm:px-6 text-slate-500 dark:text-slate-400 max-w-[200px] truncate">
                            {record.note || '-'}
                          </td>

                          <td className="py-4 px-4 sm:px-6 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                            {record.date ? new Date(record.date).toLocaleDateString('so-SO') : '-'}
                          </td>

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

        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: HABEE BILOWGA ARDAYGA (STARTING POINT & PACE CONFIGURATION) */}
      {/* ========================================================================= */}
      {progressModalStudent && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] p-6 sm:p-8 max-w-lg w-full border border-slate-200 dark:border-slate-800 shadow-2xl animate-in zoom-in-95 duration-200 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-teal-50 dark:bg-teal-950/60 text-teal-600 flex items-center justify-center">
                  <Sliders size={20} />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    Habee Meesha Uu Ardaygu Ka Bilaabayo
                  </h3>
                  <p className="text-xs text-slate-400">
                    Bisinka, Aayadda, iyo Xawaaraha Maalinlaha ah
                  </p>
                </div>
              </div>
              <button
                onClick={() => setProgressModalStudent(null)}
                className="p-1 rounded-xl text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            {/* Student Info Bar */}
            <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                <p className="font-black text-sm text-slate-900 dark:text-white">
                  {progressModalStudent.fullName}
                </p>
                <p className="text-[11px] text-slate-400">
                  Roll #{progressModalStudent.rollNumber || 'N/A'}
                </p>
              </div>
              <span className="text-xs font-bold px-2.5 py-1 rounded-xl bg-teal-100 dark:bg-teal-950 text-teal-800 dark:text-teal-200">
                Arday
              </span>
            </div>

            <form onSubmit={handleSaveProgressModal} className="space-y-4">
              {/* Surah Dropdown (114 Surahs) */}
              <div>
                <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                  1. Suuradda (Bisinka uu ka bilaabayo) *
                </label>
                <select
                  value={progressModalSurahNum}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    setProgressModalSurahNum(num);
                    setProgressModalFromVerse(1);
                  }}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {QURAN_SURAHS.map(s => (
                    <option key={s.number} value={s.number}>
                      {s.number}. {s.nameSo} ({s.nameAr}) - {s.verses} aayadood
                    </option>
                  ))}
                </select>
              </div>

              {/* Starting Verse & Daily Pace */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                    2. Aayadda Laga Bilaabo *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={
                      (QURAN_SURAHS.find(s => s.number === Number(progressModalSurahNum)) || QURAN_SURAHS[0]).verses
                    }
                    value={progressModalFromVerse}
                    onChange={(e) => setProgressModalFromVerse(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Ugu badnaan: {(QURAN_SURAHS.find(s => s.number === Number(progressModalSurahNum)) || QURAN_SURAHS[0]).verses}
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-black uppercase text-slate-600 dark:text-slate-400 mb-1">
                    3. Xawaaraha Maalinlaha ah *
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={progressModalDailyPace}
                    onChange={(e) => setProgressModalDailyPace(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                  <p className="text-[10px] text-slate-400 mt-1">
                    Inta aayadood ee uu maalinkii qaadan karo
                  </p>
                </div>
              </div>

              {/* Informative Note */}
              <div className="p-3 rounded-xl bg-teal-50/60 dark:bg-teal-950/20 border border-teal-200/60 dark:border-teal-900/30 text-[11px] text-teal-800 dark:text-teal-200">
                💡 <strong>Sida ay u shaqeyso:</strong> Markaad mar kasta xaashida ku tiraahdo <strong>"Gudbay"</strong>, system-ku si automatic ah ayuu ardayga hore ugu marinayaa tirada aayadaha aad halkaan ku geliso. Haddii uu suuradda dhammeeyo, wuxuu u gudbi doonaa suuradda xigta aayadda 1-aad. Haddii aad dhahdo <strong>"Tikraar"</strong>, halkaan kama dhaqaaqi doono.
              </div>

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setProgressModalStudent(null)}
                  className="px-5 py-2.5 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-400"
                >
                  Ka noqo
                </button>
                <button
                  type="submit"
                  disabled={progressModalSaving}
                  className="px-7 py-2.5 rounded-2xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-black shadow-lg shadow-teal-600/30"
                >
                  {progressModalSaving ? 'Waa la keydinayaa...' : 'Kaydi Bilowga'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: EDIT RECORD (HISTORY TABLE) */}
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
