import React, { useState, useEffect, useRef } from 'react';
import { 
  Plus, X, Edit2, Trash2, Users, Search, CheckCircle2, UserPlus, Loader2, 
  DollarSign, IdCard as IdCardIcon, Download, Upload, FileSpreadsheet, AlertCircle,
  LayoutGrid, List, Filter, GraduationCap, Phone, Calendar, BookOpen, Sparkles, User as UserIcon, LogOut
} from 'lucide-react';
import api from '../services/api';
import { useAlert } from '../components/common/alerts/useAlert';
import IdCard from '../components/IdCard.jsx';
import { classLabel, classSearchText } from '../utils/classLabel';
import { isValidSomaliMobile } from '../utils/somaliPhone';
import { useLanguage, translate, translateValue } from '../i18n/LanguageContext.jsx';
import { currentCycle, cycleKeyForDate, cycleShortLabel, cycleLabel, addCycles } from '../utils/billingCycle';

// The workbook columns mirror the registration form exactly. Student ID is
// exported for reference but never imported — the server issues it (1001, 1002…)
// and ignores any value sent by a client.
const SHEET_COLUMNS = [
  { header: 'Student ID', key: 'studentId', width: 12 },
  { header: 'Full Name', key: 'fullName', width: 26 },
  { header: 'Class', key: 'className', width: 18 },
  { header: 'Gender', key: 'gender', width: 10 },
  { header: 'Monthly Fee', key: 'monthlyFee', width: 13 },
  { header: 'Father Name', key: 'fatherName', width: 22 },
  { header: 'Father Phone', key: 'fatherPhone', width: 16 },
  { header: 'Fee Payer Name', key: 'payerName', width: 22 },
  { header: 'Fee Payer Phone', key: 'payerPhone', width: 18 },
  { header: 'Fee Payer Alt Phone', key: 'payerAltPhone', width: 18 },
  { header: 'Relationship', key: 'relationship', width: 14 },
  { header: 'Status', key: 'status', width: 12 }
];

const SHEET_NAME = 'Students';

// Column headers in the selected language. Import accepts the English and the
// Somali header for every column, so a file exported in either language (or an
// older English template) can always be imported.
const localizedColumns = () => SHEET_COLUMNS.map(c => ({ ...c, header: translate(`students.sheet.${c.key}`) }));
const headerAliases = (column) => [column.header, translate(`students.sheet.${column.key}`, undefined, 'en'), translate(`students.sheet.${column.key}`, undefined, 'so')]
  .map(h => String(h).toLowerCase());

// Stored values written into a sheet in Somali are mapped back to the stored
// English value on import, so the database only ever receives valid values.
const STORED_VALUES = {
  gender: ['Male', 'Female', 'Other'],
  status: ['Active', 'Inactive', 'Graduated'],
  relationship: ['Father', 'Mother', 'Guardian', 'Responsible', 'Other']
};
const valueLabel = (field, value, language) => (field === 'relationship'
  ? translate(`academic.guardians.relationships.${value}`, { defaultValue: translateValue(value, language) }, language)
  : translateValue(value, language));
const toStoredValue = (field, text) => {
  if (!text || !STORED_VALUES[field]) return text;
  const lower = String(text).trim().toLowerCase();
  const hit = STORED_VALUES[field].find(v => v.toLowerCase() === lower
    || String(valueLabel(field, v, 'so')).toLowerCase() === lower);
  return hit || text;
};
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ExcelJS is large and only needed when someone actually imports or exports, so
// it is fetched on demand rather than shipped in the main bundle.
const loadExcelJS = async () => (await import('exceljs')).default;

// A cell can come back as a string, a number, or a rich object (formula result,
// hyperlink). Flatten all of those to a plain trimmed string.
const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.text) return String(value.text).trim();
    if (value.result !== undefined) return String(value.result).trim();
    if (value.richText) return value.richText.map(r => r.text).join('').trim();
    return '';
  }
  return String(value).trim();
};

const downloadWorkbook = async (workbook, filename) => {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

const styleHeaderRow = (sheet) => {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
};

// Same normalisation the backend uses when matching a payer by phone, so an
// import cannot create a second payer for a number already stored in another
// local format (0615550001 vs 615550001).
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

// Clean text: strip non-breaking spaces, collapse whitespace, lowercase, trim
const cleanStr = (val) =>
  String(val ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Get the base name and branch if written as "Class (Branch)"
const extractBaseAndBranch = (val) => {
  const text = String(val ?? '').replace(/\u00A0/g, ' ').trim();
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(text);
  if (!match) return { base: text, branch: '' };
  return { base: match[1].trim(), branch: match[2].trim() };
};

const getClassInfo = (c) => {
  const rawName = String(c?.name || c?.className || '').trim();
  const parsed = extractBaseAndBranch(rawName);
  const branchName = c?.branchId?.name ? String(c.branchId.name).trim() : parsed.branch;
  const fullLabel = classLabel(c, rawName);
  return {
    rawName,
    base: parsed.base,
    branch: branchName,
    fullLabel
  };
};

// Resolves a sheet cell to exactly one class.
// Flexible and forgiving:
// 1. Matches exact label "mustawo 2 part (fr2)" or exact name "mustawo 2 part"
// 2. Supports "Class Name" alone when unique in the institute
// 3. Handles classes stored with "(fr2)" in their name field
// 4. Normalizes all whitespace, Unicode spaces, and case differences
const resolveClassFromCell = (cell, classes = []) => {
  const rawCell = String(cell ?? '').replace(/\u00A0/g, ' ').trim();
  const known = () => classes.map(c => classLabel(c)).filter(Boolean).join(', ') || translate('students.import.noClassesYet');

  if (!rawCell) {
    return { error: translate('students.import.classBlank') };
  }

  const cleanCell = cleanStr(rawCell);

  // 1. Direct match: Exact match on fullLabel, name, className, or rawName
  const directMatch = classes.find(c => {
    const info = getClassInfo(c);
    return (
      cleanStr(info.fullLabel) === cleanCell ||
      cleanStr(c.name) === cleanCell ||
      cleanStr(c.className) === cleanCell ||
      cleanStr(info.rawName) === cleanCell
    );
  });
  if (directMatch) {
    return { cls: directMatch };
  }

  // 2. Parse the cell value into base name and branch
  const { base: inputBase, branch: inputBranch } = extractBaseAndBranch(rawCell);
  const cleanInputBase = cleanStr(inputBase);
  const cleanInputBranch = cleanStr(inputBranch);

  // 3. Find candidate classes whose base name or raw name matches inputBase
  const candidates = classes.filter(c => {
    const info = getClassInfo(c);
    return (
      cleanStr(info.base) === cleanInputBase ||
      cleanStr(info.rawName) === cleanInputBase ||
      cleanStr(c.name) === cleanInputBase ||
      cleanStr(c.className) === cleanInputBase ||
      cleanStr(info.fullLabel) === cleanInputBase
    );
  });

  if (candidates.length > 0) {
    // If the input sheet cell specified a branch:
    if (cleanInputBranch) {
      const branchMatch = candidates.filter(c => {
        const info = getClassInfo(c);
        return (
          cleanStr(info.branch) === cleanInputBranch ||
          cleanStr(info.fullLabel).includes(`(${cleanInputBranch})`) ||
          cleanStr(info.rawName).includes(`(${cleanInputBranch})`)
        );
      });
      if (branchMatch.length === 1) return { cls: branchMatch[0] };
      if (branchMatch.length > 1) {
        return { error: translate('students.import.multipleInBranch', { cell: rawCell, branch: inputBranch }) };
      }
      // If branch didn't strictly match, but only 1 candidate class with that name exists, accept it
      if (candidates.length === 1) {
        return { cls: candidates[0] };
      }
      const options = candidates.map(c => classLabel(c)).join(', ');
      return { error: translate('students.import.noClassInBranch', { base: inputBase, branch: inputBranch, options }) };
    }

    // If no branch was specified in the Excel cell:
    // If only 1 class in the entire system carries this name, safely accept it!
    if (candidates.length === 1) {
      return { cls: candidates[0] };
    }

    // If multiple branches have a class with the same name, ask user to disambiguate:
    const options = candidates.map(c => classLabel(c)).join(', ');
    return {
      error: translate('students.import.multipleBranches', { base: inputBase, options, example: classLabel(candidates[0]) })
    };
  }

  // 4. Loose match: if the cell contains the class name or class contains the cell
  const looseCandidates = classes.filter(c => {
    const info = getClassInfo(c);
    const cLabel = cleanStr(info.fullLabel);
    const cBase = cleanStr(info.base);
    return (
      (cleanInputBase.length >= 3 && cLabel.includes(cleanInputBase)) ||
      (cBase.length >= 3 && cleanInputBase.includes(cBase))
    );
  });

  if (looseCandidates.length === 1) {
    return { cls: looseCandidates[0] };
  }

  return {
    error: translate('students.import.classMissing', { cell: rawCell, available: known() })
  };
};

const phoneVariants = (value) => {
  const d = digitsOnly(value);
  if (!d) return [];
  const set = new Set([d]);
  // Match with and without a leading zero whatever the length. Stored numbers
  // are not always 9 or 10 digits, so keying off length alone would miss an
  // existing payer and create a duplicate for the same person.
  if (d.startsWith('0')) set.add(d.replace(/^0+/, ''));
  else set.add(`0${d}`);
  return [...set].filter(Boolean);
};

const StudentsManagement = () => {
  const { showAlert, showConfirm } = useAlert();
  const { t, tv, language } = useLanguage();
  const [data, setData] = useState(() => {
    try {
      const cached = sessionStorage.getItem('cachedStudentsData');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const [classes, setClasses] = useState(() => {
    try {
      const cached = sessionStorage.getItem('cachedClassesData');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const [guardians, setGuardians] = useState([]);
  const [loading, setLoading] = useState(() => !sessionStorage.getItem('cachedStudentsData'));
  const [cardStudent, setCardStudent] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);
  const fileInputRef = useRef(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedClass, setSelectedClass] = useState('ALL');
  const [cycleFilter, setCycleFilter] = useState('ALL'); // 'ALL' | 'CURRENT' | specific cycleKey
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('studentsViewMode') || 'table';
  });

  const thisCycleKey = currentCycle();
  const newThisCycleCount = React.useMemo(() => {
    return data.filter(s => {
      const reg = s.registrationDate || s.createdAt;
      return reg && cycleKeyForDate(reg) === thisCycleKey;
    }).length;
  }, [data, thisCycleKey]);

  const [foundGuardian, setFoundGuardian] = useState(null);
  const [isSearchingGuardian, setIsSearchingGuardian] = useState(false);

  // A Date (or ISO string) rendered as the YYYY-MM-DD a date input expects,
  // using local time so the day never shifts across the UTC boundary.
  const toDateInput = (value) => {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  // Registration date for display. Read straight from the stored value's own
  // date part rather than through a locale conversion, so the day shown is
  // always the day that was saved and can never shift by a timezone offset.
  const fmtRegDate = (value) => {
    if (!value) return t('common.notAvailable');
    const iso = typeof value === 'string' ? value : new Date(value).toISOString();
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!parts) return t('common.notAvailable');
    const [, y, m, d] = parts;
    return `${d}/${m}/${y}`;
  };

  const [formData, setFormData] = useState({
    fullName: '',
    classId: '',
    gender: 'Male',
    monthlyFee: '',
    fee: '',
    feeScope: 'current',
    fatherName: '',
    fatherPhone: '',
    guardianPhone: '',
    guardianName: '',
    guardianRelationship: 'Father',
    guardianAltPhone: '',
    registrationDate: toDateInput(new Date())
  });

  const fetchData = async () => {
    try {
      if (!data.length) setLoading(true);
      const [resStudents, resClasses, resGuardians] = await Promise.all([
        api.get('/students'),
        api.get('/classes'),
        api.get('/guardians')
      ]);
      const studentsList = resStudents.data || [];
      const classesList = resClasses.data || [];
      setData(studentsList);
      setClasses(classesList);
      setGuardians(resGuardians.data || []);
      sessionStorage.setItem('cachedStudentsData', JSON.stringify(studentsList));
      sessionStorage.setItem('cachedClassesData', JSON.stringify(classesList));
    } catch (error) {
      console.error("Failed to fetch students data", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Real-time lookup for Who Pays the Fee by phone number (primary or second number)
  useEffect(() => {
    const phone = (formData.guardianPhone || '').trim();
    const altPhone = (formData.guardianAlternatePhone || '').trim();
    const searchPhone = phone || altPhone;
    const cleanSearch = digitsOnly(searchPhone);

    if (!cleanSearch || !isValidSomaliMobile(cleanSearch)) {
      setFoundGuardian(null);
      setFormData(prev => (prev.guardianId ? { ...prev, guardianId: '' } : prev));
      return;
    }

    // Skip redundant network call if the already found guardian matches either number
    const cleanPhone = digitsOnly(phone);
    const cleanAlt = digitsOnly(altPhone);
    const foundPhone = digitsOnly(foundGuardian?.phone);
    const foundAlt = digitsOnly(foundGuardian?.alternatePhone);

    if (
      foundGuardian &&
      ((cleanPhone && (cleanPhone === foundPhone || cleanPhone === foundAlt)) ||
        (cleanAlt && (cleanAlt === foundPhone || cleanAlt === foundAlt)))
    ) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearchingGuardian(true);
        const res = await api.get(`/guardians?phone=${encodeURIComponent(cleanSearch)}`);
        const existing = Array.isArray(res.data) && res.data.length > 0 ? res.data[0] : null;

        if (existing) {
          setFoundGuardian(existing);
          setFormData(prev => ({
            ...prev,
            guardianId: existing._id,
            guardianName: existing.fullName || prev.guardianName,
            guardianRelationship: existing.relationship || prev.guardianRelationship || 'Father',
            guardianPhone: existing.phone || prev.guardianPhone || '',
            guardianAlternatePhone: existing.alternatePhone || prev.guardianAlternatePhone || ''
          }));
        } else {
          setFoundGuardian(null);
          setFormData(prev => (prev.guardianId ? { ...prev, guardianId: '' } : prev));
        }
      } catch (err) {
        console.error('Phone lookup failed:', err);
      } finally {
        setIsSearchingGuardian(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [formData.guardianPhone, formData.guardianAlternatePhone, foundGuardian]);

  // ── Excel template ────────────────────────────────────────────────────────
  // Same columns as the export, so a filled-in template and an exported file are
  // interchangeable as import sources.
  const handleDownloadTemplate = async () => {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(t('students.sheet.sheetName'));
    sheet.columns = localizedColumns();
    styleHeaderRow(sheet);

    sheet.addRow({
      studentId: t('students.sheet.leaveBlank'),
      fullName: t('students.sheet.exampleName'),
      className: classes[0] ? classLabel(classes[0]) : 'Tamhiid 3 (FR1)',
      gender: valueLabel('gender', 'Male', language),
      monthlyFee: 20,
      fatherName: t('students.sheet.exampleFather'),
      fatherPhone: '0615551234',
      payerName: t('students.sheet.exampleFather'),
      payerPhone: '0615551234',
      payerAltPhone: '',
      relationship: valueLabel('relationship', 'Father', language),
      status: valueLabel('status', 'Active', language)
    });
    sheet.getRow(2).font = { italic: true, color: { argb: 'FF94A3B8' } };

    const notes = workbook.addWorksheet(t('students.sheet.instructionsName'));
    notes.columns = [{ width: 96 }];
    [
      ...t('students.sheet.instructionsTop'),
      t('students.sheet.existingClasses', { classes: classes.map(c => classLabel(c)).filter(Boolean).join(', ') || t('students.sheet.noneYet') }),
      ...t('students.sheet.instructionsBottom')
    ].forEach(line => notes.addRow([line]));
    notes.getRow(1).font = { bold: true, size: 13 };

    await downloadWorkbook(workbook, t('students.sheet.templateFile'));
    showAlert({ type: 'success', title: t('students.alerts.templateTitle'), message: t('students.alerts.templateMsg') });
  };

  // ── Export ────────────────────────────────────────────────────────────────
  // One row per student using the registration fields plus the payer resolved
  // through guardianId. The file can be re-imported as-is.
  const handleExport = async () => {
    const ExcelJS = await loadExcelJS();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(t('students.sheet.sheetName'));
    sheet.columns = localizedColumns();
    styleHeaderRow(sheet);

    data.forEach((item) => {
      const cls = classes.find(c => String(c._id) === String(item.classId?._id || item.classId));
      const guardian = item.guardianId && typeof item.guardianId === 'object' ? item.guardianId : null;
      sheet.addRow({
        studentId: item.studentCode || '',
        fullName: item.fullName || '',
        className: cls ? classLabel(cls, '') : '',
        gender: item.gender ? valueLabel('gender', item.gender, language) : '',
        monthlyFee: Number(item.monthlyFee ?? item.fee ?? 0),
        fatherName: item.fatherName || '',
        // Phones are written as text so a leading zero is never dropped.
        fatherPhone: item.fatherPhone || '',
        payerName: guardian?.fullName || '',
        payerPhone: guardian?.phone || '',
        payerAltPhone: guardian?.alternatePhone || '',
        relationship: guardian?.relationship ? valueLabel('relationship', guardian.relationship, language) : '',
        status: valueLabel('status', item.status || 'Active', language)
      });
    });

    ['fatherPhone', 'payerPhone', 'payerAltPhone'].forEach(key => {
      sheet.getColumn(key).numFmt = '@';
    });

    await downloadWorkbook(workbook, `${t('students.sheet.exportFile')}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    showAlert({
      type: 'success',
      title: t('students.alerts.exportTitle'),
      message: t('students.alerts.exportMsg', { count: data.length })
    });
  };

  // ── Import ────────────────────────────────────────────────────────────────
  // Resolve the payer by phone exactly as registration does: find an existing
  // record first, reuse it when found, create one only when needed. An existing
  // payer is never updated — that would rewrite the name for every student
  // already attached to them.
  const resolveGuardian = async (row, cache) => {
    const phone = row.payerPhone;
    if (!phone) return null;

    const variants = phoneVariants(phone);
    const cacheKey = variants.join('|');
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    for (const variant of variants) {
      const { data: found } = await api.get(`/guardians?phone=${encodeURIComponent(variant)}`);
      if (Array.isArray(found) && found.length > 0) {
        cache.set(cacheKey, found[0]._id);
        return found[0]._id;
      }
    }

    const { data: created } = await api.post('/guardians', {
      fullName: row.payerName || row.fatherName || 'Fee Payer',
      phone,
      alternatePhone: row.payerAltPhone || '',
      relationship: toStoredValue('relationship', row.relationship) || 'Father'
    });
    const id = created?._id || created?.id || null;
    if (id) cache.set(cacheKey, id);
    return id;
  };

  // A student is treated as already present when the same name sits in the same
  // class under the same father's phone. There is no unique key on students in
  // the schema, so this is the closest match to a real-world duplicate.
  const studentKey = (name, classId, fatherPhone) =>
    `${String(name).trim().toLowerCase()}|${String(classId)}|${digitsOnly(fatherPhone)}`;

  const importRow = async (row, existingKeys, cache) => {
    if (!row.fullName) throw new Error(t('students.import.fullNameRequired'));

    // Matched on class name AND branch together, so "Tamhiid 3 (FR1)" and
    // "Tamhiid 3 (FR2)" land on their own class rather than whichever was
    // created first.
    const { cls, error: classError } = resolveClassFromCell(row.className, classes);
    if (classError) throw new Error(classError);

    // Father name and phone are optional here, exactly as on the registration
    // form: each falls back to the fee payer's details before being stored.
    const fatherName = row.fatherName || row.payerName || '';
    const fatherPhone = row.fatherPhone || row.payerPhone || '';

    // Key on the value that actually gets stored, so an exported file re-imports
    // as "already registered" even when the sheet's Father Phone cell was blank.
    const key = studentKey(row.fullName, cls._id, fatherPhone);
    if (existingKeys.has(key)) throw new Error(t('students.import.alreadyRegistered'));

    const guardianId = await resolveGuardian(row, cache);

    // Student ID is deliberately omitted: the server issues it.
    await api.post('/students', {
      fullName: row.fullName,
      classId: cls._id,
      gender: toStoredValue('gender', row.gender) || 'Male',
      monthlyFee: Number(row.monthlyFee) || 0,
      fee: Number(row.monthlyFee) || 0,
      fatherName,
      fatherPhone,
      guardianId: guardianId || undefined,
      status: toStoredValue('status', row.status) || 'Active'
    });

    existingKeys.add(key);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    setImporting(true);
    setImportResults(null);

    try {
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.getWorksheet(SHEET_NAME) || workbook.getWorksheet(translate('students.sheet.sheetName', undefined, 'so')) || workbook.worksheets[0];
      if (!sheet) throw new Error(t('students.import.noSheets'));

      // Map by header text so column order does not matter.
      const headerRow = sheet.getRow(1);
      const indexByHeader = {};
      headerRow.eachCell((cell, col) => {
        const match = SHEET_COLUMNS.find(c => headerAliases(c).includes(cellText(cell.value).toLowerCase()));
        if (match) indexByHeader[match.key] = col;
      });

      if (indexByHeader.fullName === undefined) {
        throw new Error(t('students.import.noFullNameColumn'));
      }

      const rows = [];
      sheet.eachRow((excelRow, rowNumber) => {
        if (rowNumber === 1) return;
        const row = {};
        SHEET_COLUMNS.forEach(({ key }) => {
          const col = indexByHeader[key];
          row[key] = col ? cellText(excelRow.getCell(col).value) : '';
        });
        // Skip the template's grey example row and any blank line.
        if (!row.fullName || [translate('students.sheet.leaveBlank', undefined, 'en'), translate('students.sheet.leaveBlank', undefined, 'so')].includes(row.studentId)) return;
        rows.push({ ...row, rowNumber });
      });

      if (!rows.length) {
        setImporting(false);
        showAlert({ type: 'warning', title: t('students.alerts.nothingTitle'), message: t('students.alerts.nothingMsg') });
        return;
      }

      const existingKeys = new Set(
        data.map(s => studentKey(s.fullName, s.classId?._id || s.classId, s.fatherPhone))
      );
      const cache = new Map();
      const results = [];

      // Sequential on purpose: rows sharing a payer must reuse the same record
      // rather than racing to create duplicates.
      for (const row of rows) {
        try {
          await importRow(row, existingKeys, cache);
          results.push({ row: row.rowNumber, name: row.fullName, ok: true, message: t('students.import.imported') });
        } catch (error) {
          results.push({
            row: row.rowNumber,
            name: row.fullName || t('students.import.rowLabel', { row: row.rowNumber }),
            ok: false,
            message: error.response?.data?.message || error.message
          });
        }
      }

      await fetchData();
      setImportResults(results);
    } catch (error) {
      showAlert({
        type: 'danger',
        title: t('students.alerts.readFailedTitle'),
        message: error.message || t('students.alerts.readFailedMsg')
      });
    } finally {
      setImporting(false);
    }
  };


  const openAddModal = () => {
    setEditingItem(null);
    setFoundGuardian(null);
    setFormData({
      fullName: '',
      classId: classes[0]?._id || '',
      gender: 'Male',
      monthlyFee: '',
      feeScope: 'current',
      fatherName: '',
      fatherPhone: '',
      guardianId: '',
      guardianName: '',
      guardianPhone: '',
      guardianAlternatePhone: '',
      guardianRelationship: 'Father',
      registrationDate: toDateInput()
    });
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    const existingG = item.guardianId && typeof item.guardianId === 'object' ? item.guardianId : null;
    setFoundGuardian(existingG);
    setFormData({
      fullName: item.fullName || '',
      classId: item.classId?._id || item.classId || '',
      gender: item.gender || 'Male',
      monthlyFee: item.monthlyFee !== undefined ? item.monthlyFee : (item.fee || ''),
      feeScope: 'current',
      fatherName: item.fatherName || '',
      fatherPhone: item.fatherPhone || '',
      guardianId: existingG?._id || item.guardianId || '',
      guardianName: existingG?.fullName || '',
      guardianPhone: existingG?.phone || '',
      guardianAlternatePhone: existingG?.alternatePhone || '',
      guardianRelationship: existingG?.relationship || 'Father',
      // Show the date already stored on the record. Only a student that somehow
      // has none falls back to today, so editing never rewrites a saved date.
      registrationDate: item.registrationDate ? toDateInput(item.registrationDate) : toDateInput()
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName) {
      showAlert({ type: 'warning', title: t('common.validationError'), message: t('students.alerts.nameRequired') });
      return;
    }

    try {
      let guardianId = formData.guardianId;

      // When a fee payer phone is provided, resolve the guardian record:
      // If a guardian with this phone already exists in the system, POST /guardians safely
      // reuses and returns that existing record. If not, it creates a new guardian record.
      // This links the student to the existing guardian without creating duplicates
      // or throwing duplicate phone errors when re-assigning students to existing guardians.
      if (formData.guardianPhone) {
        const guardianPayload = {
          fullName: formData.guardianName || formData.fatherName || 'Fee Payer',
          phone: formData.guardianPhone,
          alternatePhone: formData.guardianAlternatePhone,
          relationship: formData.guardianRelationship || 'Father'
        };

        const guardianRes = await api.post('/guardians', guardianPayload);
        guardianId = guardianRes.data?._id || guardianRes.data?.id || guardianId;
      } else {
        guardianId = undefined;
      }

      const payload = {
        fullName: formData.fullName,
        classId: formData.classId,
        gender: formData.gender,
        monthlyFee: Number(formData.monthlyFee) || 0,
        fee: Number(formData.monthlyFee) || 0,
        feeScope: formData.feeScope || 'current',
        fatherName: formData.guardianName || formData.fatherName || '',
        fatherPhone: formData.guardianPhone || formData.fatherPhone || '',
        guardianId: guardianId || undefined,
        // Sent only when the field holds a date, so clearing the input can never
        // blank a registration date already stored against the student.
        ...(formData.registrationDate ? { registrationDate: formData.registrationDate } : {})
      };

      if (editingItem) {
        await api.put(`/students/${editingItem._id}`, payload);
        showAlert({ type: 'success', title: t('common.success'), message: t('students.alerts.updated') });
      } else {
        await api.post('/students', payload);
        showAlert({ type: 'success', title: t('common.success'), message: t('students.alerts.registered') });
      }
      setIsModalOpen(false);
      fetchData();
    } catch (error) {
      console.error('Failed to save student', error);
      showAlert({ type: 'danger', title: t('common.error'), message: error.response?.data?.message || t('students.alerts.saveFailed') });
    }
  };

  const handleDelete = async (item) => {
    const ok = await showConfirm({
      type: 'warning',
      title: t('students.alerts.deleteTitle'),
      message: t('students.alerts.deleteConfirm', { name: item.fullName }),
      confirmText: t('common.yesDelete'),
      cancelText: t('common.cancel'),
      danger: true
    });
    if (!ok) return;

    try {
      await api.delete(`/students/${item._id}`);
      setData(prev => prev.filter(i => i._id !== item._id));
      showAlert({ type: 'success', title: t('common.deleted'), message: t('students.alerts.deletedMsg') });
    } catch (error) {
      console.error("Failed to delete student", error);
      showAlert({ type: 'danger', title: t('common.error'), message: t('students.alerts.deleteFailed') });
    }
  };

  // Exit / archive a student. This is NOT a delete: the record and all history
  // are kept and the student moves to the Exit Students section.
  const [exitingStudent, setExitingStudent] = useState(null);
  const [exitReason, setExitReason] = useState('');
  const [exitDate, setExitDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [exitSaving, setExitSaving] = useState(false);

  const openExitModal = (item) => {
    setExitingStudent(item);
    setExitReason('');
    setExitDate(new Date().toISOString().split('T')[0]);
  };

  const handleConfirmExit = async () => {
    if (!exitingStudent) return;
    try {
      setExitSaving(true);
      await api.post(`/students/${exitingStudent._id}/exit`, {
        exitReason: exitReason.trim(),
        exitDate
      });
      // The student leaves every active list immediately (backend now excludes
      // Exited from active queries too).
      setData(prev => prev.filter(i => i._id !== exitingStudent._id));
      showAlert({
        type: 'success',
        title: t('students.alerts.exitedTitle'),
        message: t('students.alerts.exitedMsg', { name: exitingStudent.fullName })
      });
      setExitingStudent(null);
    } catch (error) {
      console.error('Failed to exit student', error);
      showAlert({ type: 'danger', title: t('students.alerts.exitFailed'), message: error.response?.data?.message || t('attendance.student.tryAgain') });
    } finally {
      setExitSaving(false);
    }
  };

  const filteredData = data.filter(item => {
    if (selectedClass !== 'ALL') {
      const itemClassId = String(item.classId?._id || item.classId || '');
      if (itemClassId !== String(selectedClass)) {
        return false;
      }
    }

    if (cycleFilter !== 'ALL') {
      const targetCycle = cycleFilter === 'CURRENT' ? thisCycleKey : cycleFilter;
      const reg = item.registrationDate || item.createdAt;
      if (!reg) return false;
      if (cycleKeyForDate(reg) !== targetCycle) return false;
    }

    if (!searchTerm.trim()) return true;

    const term = searchTerm.toLowerCase();
    const gName = item.guardianId?.fullName || '';
    const gPhone = item.guardianId?.phone || '';
    const className = classSearchText(item.classId);
    return (
      (item.fullName || '').toLowerCase().includes(term) ||
      (item.studentCode || '').toLowerCase().includes(term) ||
      (item.fatherName || '').toLowerCase().includes(term) ||
      (item.fatherPhone || '').toLowerCase().includes(term) ||
      gName.toLowerCase().includes(term) ||
      gPhone.toLowerCase().includes(term) ||
      (item.guardianId?.alternatePhone || '').toLowerCase().includes(term) ||
      className.toLowerCase().includes(term)
    );
  });

  // Summary Metrics
  const totalStudentsCount = data.length;
  const filteredStudentsCount = filteredData.length;
  const totalMonthlyFee = filteredData.reduce((acc, curr) => acc + Number(curr.monthlyFee ?? curr.fee ?? 0), 0);

  // Class student counts map for filter
  const classCounts = React.useMemo(() => {
    const map = {};
    data.forEach(s => {
      const cid = String(s.classId?._id || s.classId || '');
      if (cid) {
        map[cid] = (map[cid] || 0) + 1;
      }
    });
    return map;
  }, [data]);

  if (loading) return <div className="p-10 text-center text-slate-500">{t('students.loading')}</div>;

  return (
    <div className="p-6 lg:p-8 space-y-8 max-w-[1800px] mx-auto animate-in fade-in duration-700 pb-24">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-2">
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 bg-slate-900 dark:bg-slate-800 rounded-[24px] flex items-center justify-center text-emerald-400 shadow-2xl border border-slate-700 ring-4 ring-emerald-400/10">
            <Users size={32} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900 dark:text-white tracking-tight uppercase leading-none">{t('students.title')}</h1>
            <p className="text-slate-500 dark:text-slate-400 text-[10px] font-black mt-2 uppercase tracking-[0.2em] opacity-80">{t('students.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleImportFile}
            className="hidden"
          />
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 px-6 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-[20px] font-black text-[11px] uppercase tracking-[0.2em] shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95"
          >
            <FileSpreadsheet size={16} strokeWidth={3} /> {t('students.excelTemplate')}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-6 py-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-[20px] font-black text-[11px] uppercase tracking-[0.2em] shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing
              ? <><Loader2 size={16} className="animate-spin" /> {t('students.importing')}</>
              : <><Upload size={16} strokeWidth={3} /> {t('students.importExcel')}</>}
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 px-6 py-4 bg-slate-900 dark:bg-slate-800 text-white rounded-[20px] font-black text-[11px] uppercase tracking-[0.2em] shadow-md hover:bg-slate-800 transition-all active:scale-95"
          >
            <Download size={16} strokeWidth={3} /> {t('students.exportExcel')}
          </button>
          <button
            onClick={openAddModal}
            className="flex items-center gap-3 px-8 py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-[20px] font-black text-[11px] uppercase tracking-[0.2em] shadow-xl transition-all active:scale-95"
          >
            <Plus size={18} strokeWidth={3} /> {t('students.addNew')}
          </button>
        </div>
      </div>

      {/* Per-row import result */}
      {importResults && (
        <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="text-brand-500" size={20} />
              <div>
                <h3 className="font-black text-slate-900 dark:text-white uppercase text-sm tracking-tight">{t('students.importResult')}</h3>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                  {t('students.importSummary', { imported: importResults.filter(r => r.ok).length, skipped: importResults.filter(r => !r.ok).length, total: importResults.length })}
                </p>
              </div>
            </div>
            <button
              onClick={() => setImportResults(null)}
              className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              aria-label={t('students.dismissImport')}
            >
              <X size={18} />
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {importResults.map((r) => (
              <div key={r.row} className="flex items-start gap-3 px-6 py-3">
                {r.ok
                  ? <CheckCircle2 size={16} className="text-emerald-500 mt-0.5 shrink-0" />
                  : <AlertCircle size={16} className="text-rose-500 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                    {t('students.import.rowLabel', { row: r.row })} — {r.name}
                  </p>
                  <p className={`text-xs font-semibold ${r.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                    {r.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search Bar & Class Filter Row - Single horizontal line, elongated search, compact filters */}
      <div className="flex flex-row items-center gap-2 w-full">
        {/* Search Bar - Elongated & expanded */}
        <div className="flex items-center bg-white dark:bg-slate-900 rounded-2xl px-4 py-2.5 border border-slate-100 dark:border-slate-800 shadow-sm flex-1 min-w-[180px] focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all">
          <Search size={18} className="text-slate-400 mr-2.5 shrink-0" />
          <input
            type="text"
            placeholder={t('students.searchPlaceholder')}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent outline-none text-sm text-slate-900 dark:text-white placeholder:text-slate-400 border-none p-0 focus:ring-0 font-medium"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Class Filter - Compact */}
        <div className="flex items-center bg-white dark:bg-slate-900 rounded-2xl px-3 py-2.5 border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
          <Filter size={15} className="text-emerald-500 mr-1.5 shrink-0" />
          <select
            value={selectedClass}
            onChange={(e) => setSelectedClass(e.target.value)}
            className="bg-transparent outline-none text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 cursor-pointer border-none p-0 focus:ring-0"
          >
            <option value="ALL">All Classes ({data.length})</option>
            {classes.map(c => {
              const count = classCounts[String(c._id)] || 0;
              const label = classLabel(c, c.name || c.className || t('common.class'));
              return (
                <option key={c._id} value={c._id}>
                  {label} ({count})
                </option>
              );
            })}
          </select>
          {selectedClass !== 'ALL' && (
            <button 
              onClick={() => setSelectedClass('ALL')}
              title={t('students.resetFilter')}
              className="ml-1 text-slate-400 hover:text-rose-500 transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Cycle Filter Dropdown - "All" visibly shown */}
        <div className="flex items-center bg-white dark:bg-slate-900 rounded-2xl px-3 py-2.5 border border-slate-100 dark:border-slate-800 shadow-sm shrink-0">
          <Calendar size={15} className="text-amber-500 mr-1.5 shrink-0" />
          <select
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            className="bg-transparent outline-none text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 cursor-pointer border-none p-0 focus:ring-0"
          >
            <option value="ALL">All ({data.length})</option>
            <option value="CURRENT">✨ Cusub ({newThisCycleCount})</option>
            <option value={addCycles(thisCycleKey, -1)}>📅 Hore</option>
          </select>
          {cycleFilter !== 'ALL' && (
            <button 
              onClick={() => setCycleFilter('ALL')}
              title={t('students.resetFilter')}
              className="ml-1 text-slate-400 hover:text-rose-500 transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Quick Toggle Chip for "New This Cycle" - Shortened */}
        <button
          onClick={() => setCycleFilter(prev => prev === 'CURRENT' ? 'ALL' : 'CURRENT')}
          className={`flex items-center gap-1.5 px-3 py-2.5 rounded-2xl text-xs font-black transition-all shrink-0 ${
            cycleFilter === 'CURRENT'
              ? 'bg-amber-500 text-white shadow-sm ring-2 ring-amber-400'
              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-100 dark:border-slate-800 hover:border-amber-400 shadow-sm'
          }`}
          title="Kala saar ardayda cycle-kan la diiwaangeliyay oo keliya"
        >
          <Sparkles size={13} className={cycleFilter === 'CURRENT' ? 'animate-pulse text-white' : 'text-amber-500'} />
          <span>Cusub</span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold ${
            cycleFilter === 'CURRENT' ? 'bg-white/20 text-white' : 'bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400'
          }`}>
            {newThisCycleCount}
          </span>
        </button>

        {/* Right side: Count Badge & View Mode Switcher */}
        <div className="flex items-center gap-1.5 ml-auto shrink-0">
          <div className="flex items-center text-xs font-bold text-slate-400 px-2.5 py-2.5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm whitespace-nowrap">
            <span>{filteredStudentsCount}/{totalStudentsCount}</span>
          </div>

          <div className="flex items-center gap-0.5 bg-white dark:bg-slate-900 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
            <button
              onClick={() => { setViewMode('table'); localStorage.setItem('studentsViewMode', 'table'); }}
              className={`p-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'table'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
              title={t('students.tableView')}
            >
              <List size={14} />
            </button>
            <button
              onClick={() => { setViewMode('grid'); localStorage.setItem('studentsViewMode', 'grid'); }}
              className={`p-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'grid'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
              title={t('students.cardsView')}
            >
              <LayoutGrid size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Active Cycle Filter Banner */}
      {cycleFilter !== 'ALL' && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-2xl p-4 text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles size={16} />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
                {cycleFilter === 'CURRENT' 
                  ? `Ardayda Cusub ee Cycle-kan (${cycleLabel(thisCycleKey)})`
                  : `Ardayda la diiwaangeliyay Cycle-ka (${cycleLabel(cycleFilter)})`}
              </p>
              <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mt-0.5">
                Waxaad arkeysaa <strong>{filteredStudentsCount}</strong> arday oo cycle-kan la diiwaangeliyay oo keliya. Ardaydii hore waa laga soocay.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCycleFilter('ALL')}
            className="flex items-center gap-1.5 self-start sm:self-auto text-xs font-black text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-white px-3 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 transition-colors shrink-0"
          >
            <X size={14} />
            <span>Muuji Dhammaan Ardayda</span>
          </button>
        </div>
      )}

      {/* Main Student Directory Content: Table (default) or Cards View */}
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredData.map(item => {
            const guardian = item.guardianId && typeof item.guardianId === 'object' ? item.guardianId : null;
            const cls = item.classId && typeof item.classId === 'object' ? item.classId : classes.find(c => c._id === item.classId);
            const studentFee = item.monthlyFee !== undefined ? item.monthlyFee : (item.fee || 0);

            return (
              <div 
                key={item._id}
                className="group relative bg-white dark:bg-slate-900 rounded-[30px] p-5 border border-slate-100 dark:border-slate-800 shadow-sm hover:shadow-card-hover hover:border-emerald-500/30 hover:-translate-y-1 transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  {/* Top: Avatar, Name & ID */}
                  <div className="flex items-start gap-3.5 mb-4">
                    <div className="relative w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-black text-base shadow-md shadow-emerald-600/20 ring-2 ring-white dark:ring-slate-800">
                      {(item.fullName || 'A').charAt(0).toUpperCase()}
                      <span className={`absolute -bottom-1 -right-1 px-1.5 py-0.2 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                        item.gender === 'Female' ? 'bg-pink-500 text-white' : 'bg-blue-600 text-white'
                      }`}>
                        {item.gender === 'Female' ? t('students.femaleShort') : t('students.maleShort')}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-base font-extrabold text-slate-900 dark:text-white truncate leading-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors" title={item.fullName}>
                        {item.fullName}
                      </h4>
                      <span className="inline-block mt-1 font-mono text-xs font-black text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-lg border border-emerald-500/20">
                        {item.studentCode || t('attendance.student.noId')}
                      </span>
                    </div>
                  </div>

                  {/* Details Badges */}
                  <div className="space-y-2.5 my-3 pt-3 border-t border-slate-100 dark:border-slate-800/80">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                        <BookOpen size={14} className="text-emerald-500" /> {t('common.class')}:
                      </span>
                      <span className="font-extrabold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-xl truncate max-w-[150px]">
                        {cls?.name || cls?.className || '-'}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400 font-semibold flex items-center gap-1.5">
                        <DollarSign size={14} className="text-emerald-500" /> {t('students.studentFee')}:
                      </span>
                      <span className="font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-xl border border-emerald-500/20">
                        ${Number(studentFee).toLocaleString()}
                      </span>
                    </div>

                    {/* Fee Payer Info */}
                    <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/60 p-2.5 space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
                          <UserIcon size={11} /> {t('students.whoPays')}:
                        </span>
                        <span className="font-bold text-slate-700 dark:text-slate-300 truncate max-w-[130px]">
                          {guardian?.fullName || item.fatherName || t('students.notLinked')}
                        </span>
                      </div>
                      {(guardian?.phone || item.fatherPhone) && (
                        <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200/50 dark:border-slate-700/50">
                          <span className="text-slate-400 font-medium">{t('common.phone')}:</span>
                          <a 
                            href={`tel:${guardian?.phone || item.fatherPhone}`}
                            className="font-mono font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
                          >
                            <Phone size={11} />
                            {guardian?.phone || item.fatherPhone}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                    <Calendar size={12} />
                    {item.registrationDate ? fmtRegDate(item.registrationDate) : t('common.notAvailable')}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button 
                      onClick={() => setCardStudent(item)} 
                      title={t('academic.teachers.idCard')} 
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 text-slate-600 dark:text-slate-300 hover:text-emerald-600 rounded-xl transition-colors"
                    >
                      <IdCardIcon size={15} />
                    </button>
                    <button 
                      onClick={() => openEditModal(item)} 
                      title={t('students.editTitle')} 
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-slate-600 dark:text-slate-300 hover:text-blue-600 rounded-xl transition-colors"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => openExitModal(item)}
                      title={t('students.exitStudent')}
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-900/30 text-slate-600 dark:text-slate-300 hover:text-amber-600 rounded-xl transition-colors"
                    >
                      <LogOut size={15} />
                    </button>
                    <button
                      onClick={() => handleDelete(item)}
                      title={t('students.deleteStudent')}
                      className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-900/30 text-slate-600 dark:text-slate-300 hover:text-rose-500 rounded-xl transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Data Table - Fitted cleanly to screen with no horizontal scrolling */
        <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left border-collapse table-auto">
              <thead>
                <tr className="bg-slate-50/70 dark:bg-slate-800/40 text-slate-400 text-[10px] font-black uppercase tracking-wider border-b border-slate-100 dark:border-slate-800">
                  <th className="px-4 py-4 whitespace-nowrap">{t('students.colFullName')}</th>
                  <th className="px-3 py-4 whitespace-nowrap">{t('students.colStudentId')}</th>
                  <th className="px-3 py-4 whitespace-nowrap">{t('common.class')}</th>
                  <th className="px-3 py-4 whitespace-nowrap">{t('students.colFee')}</th>
                  <th className="px-4 py-4 whitespace-nowrap">{t('students.colWhoPays')}</th>
                  <th className="px-3 py-4 whitespace-nowrap">{t('students.colRegDate')}</th>
                  <th className="px-4 py-4 text-right whitespace-nowrap">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredData.map((item) => {
                  const guardian = item.guardianId && typeof item.guardianId === 'object' ? item.guardianId : null;
                  const cls = item.classId && typeof item.classId === 'object' ? item.classId : classes.find(c => c._id === item.classId);
                  const studentFee = item.monthlyFee !== undefined ? item.monthlyFee : (item.fee || 0);

                  return (
                    <tr key={item._id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center font-extrabold text-xs shrink-0 shadow-sm">
                            {(item.fullName || 'A').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-sm text-slate-900 dark:text-white block truncate max-w-[200px]" title={item.fullName}>
                              {item.fullName}
                            </span>
                            <span className="text-[10px] text-slate-400 font-semibold uppercase">{tv(item.gender || 'Male')}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs font-black text-emerald-500 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                          {item.studentCode || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                        <span className="truncate block max-w-[140px]" title={cls?.name || cls?.className || '-'}>
                          {cls?.name || cls?.className || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-3.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                        ${Number(studentFee).toLocaleString()}
                      </td>
                      <td className="px-4 py-3.5 text-xs">
                        {guardian ? (
                          <div className="min-w-0">
                            <span className="font-bold text-slate-900 dark:text-slate-100 block truncate max-w-[180px]" title={guardian.fullName}>
                              {guardian.fullName}
                            </span>
                            <div className="text-[11px] font-mono truncate max-w-[200px] flex items-center gap-1.5 flex-wrap mt-0.5">
                              {guardian.phone && (
                                <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{guardian.phone}</span>
                              )}
                              {guardian.alternatePhone && guardian.alternatePhone !== guardian.phone && (
                                <span className="text-blue-600 dark:text-blue-400 font-semibold">• {guardian.alternatePhone}</span>
                              )}
                              {guardian.relationship && (
                                <span className="text-[10px] uppercase font-semibold text-slate-400">({t(`academic.guardians.relationships.${guardian.relationship}`, { defaultValue: tv(guardian.relationship) })})</span>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <span className="font-bold text-slate-900 dark:text-slate-100 block truncate max-w-[180px]">
                              {item.fatherName || t('students.notLinked')}
                            </span>
                            {item.fatherPhone && <span className="text-[11px] text-slate-400 block font-mono">{item.fatherPhone}</span>}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-3.5 text-xs font-medium text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {item.registrationDate ? fmtRegDate(item.registrationDate) : <span className="text-slate-400 opacity-60">{t('common.notAvailable')}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <div className="flex justify-end items-center gap-1.5">
                          <button onClick={() => setCardStudent(item)} title={t('academic.teachers.idCard')} className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all">
                            <IdCardIcon size={15} />
                          </button>
                          <button onClick={() => openEditModal(item)} title={t('students.editTitle')} className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 hover:text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-950/40 transition-all">
                            <Edit2 size={15} />
                          </button>
                          <button onClick={() => openExitModal(item)} title={t('students.exitStudent')} className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all">
                            <LogOut size={15} />
                          </button>
                          <button onClick={() => handleDelete(item)} title={t('students.deleteStudent')} className="p-1.5 bg-slate-50 dark:bg-slate-800 rounded-lg text-slate-600 dark:text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all">
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
        </div>
      )}

      {/* Empty State */}
      {filteredData.length === 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-[36px] border border-slate-100 dark:border-slate-800 p-12 text-center shadow-sm">
          <div className="w-16 h-16 rounded-3xl bg-slate-100 dark:bg-slate-800 text-slate-400 mx-auto flex items-center justify-center mb-4">
            <Users size={32} />
          </div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">{t('students.emptyTitle')}</h3>
          <p className="text-slate-400 text-sm mt-1 max-w-sm mx-auto">
            {searchTerm || selectedClass !== 'ALL'
              ? t('students.emptyFiltered')
              : t('students.emptyNone')}
          </p>
          {(searchTerm || selectedClass !== 'ALL') ? (
            <button
              onClick={() => { setSearchTerm(''); setSelectedClass('ALL'); }}
              className="mt-5 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-brand-600/20"
            >
              {t('students.resetFilters')}
            </button>
          ) : (
            <button
              onClick={openAddModal}
              className="mt-5 px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-brand-600/20"
            >
              + {t('students.registerNew')}
            </button>
          )}
        </div>
      )}

      {/* Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] p-8 max-w-xl w-full shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                {editingItem ? t('students.editTitle') : t('students.addNew')}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-full">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Student Details Section */}
              <div className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 pt-1">
                {t('students.studentDetails')}
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('students.fullNameLabel')}</label>
                <input
                  type="text"
                  required
                  placeholder={t('students.fullNamePlaceholder')}
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('students.colStudentId')}</label>
                  {/* Issued by the server on save and never editable, so this is a
                      display only — there is no input bound to it. */}
                  <div className="w-full px-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 font-mono text-sm font-black text-brand-600 dark:text-brand-400">
                    {editingItem?.studentCode || t('students.assignedAutomatically')}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.class')}</label>
                  <select
                    value={formData.classId}
                    onChange={(e) => setFormData({ ...formData, classId: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                  >
                    <option value="">{t('common.selectClass')}</option>
                    {classes.map(c => (
                      <option key={c._id} value={c._id}>{classLabel(c)}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('common.gender')}</label>
                  <select
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                  >
                    <option value="Male">{tv('Male')}</option>
                    <option value="Female">{tv('Female')}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('students.colRegDate')}</label>
                  <input
                    type="date"
                    value={formData.registrationDate}
                    onChange={(e) => setFormData({ ...formData, registrationDate: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('students.feeLabel')}</label>
                  <div className="relative">
                    <DollarSign size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
                    <input
                      type="number"
                      required
                      placeholder="0.00"
                      value={formData.monthlyFee}
                      onChange={(e) => setFormData({ ...formData, monthlyFee: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                    />
                  </div>
                </div>
              </div>

              {/* Fee Change Scope (Visible when editing student) */}
              {editingItem && (
                <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-700/80">
                  <label className="block text-xs font-black uppercase text-slate-500 mb-2">
                    {t('students.feeScopeLabel')}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, feeScope: 'current' })}
                      className={`p-3 rounded-xl text-left border transition-all ${
                        formData.feeScope === 'current'
                          ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <span className="block text-xs font-black">{t('students.feeScopeCurrent')}</span>
                      <span className={`text-[10px] block mt-0.5 leading-snug ${formData.feeScope === 'current' ? 'text-white/80' : 'text-slate-400'}`}>
                        {t('students.feeScopeCurrentHint')}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, feeScope: 'all' })}
                      className={`p-3 rounded-xl text-left border transition-all ${
                        formData.feeScope === 'all'
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700/50'
                      }`}
                    >
                      <span className="block text-xs font-black">{t('students.feeScopeAll')}</span>
                      <span className={`text-[10px] block mt-0.5 leading-snug ${formData.feeScope === 'all' ? 'text-white/80' : 'text-slate-400'}`}>
                        {t('students.feeScopeAllHint')}
                      </span>
                    </button>
                  </div>
                </div>
              )}

              {/* Who Pays the Fee Section */}
              <div className="border-t border-slate-100 dark:border-slate-800 pt-4 mt-2">
                <div className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-3">
                  {t('students.whoPaysSection')}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('students.payerPhone')}</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder={t('students.payerPhonePlaceholder')}
                        value={formData.guardianPhone}
                        onChange={(e) => setFormData({ ...formData, guardianPhone: e.target.value })}
                        className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                      />
                      {isSearchingGuardian && (
                        <Loader2 className="animate-spin absolute right-3 top-3.5 text-slate-400" size={18} />
                      )}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('students.payerAltPhone')}</label>
                    <input
                      type="text"
                      placeholder={t('students.payerAltPlaceholder')}
                      value={formData.guardianAlternatePhone}
                      onChange={(e) => setFormData({ ...formData, guardianAlternatePhone: e.target.value })}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('students.payerName')}</label>
                    <input
                      type="text"
                      placeholder={t('students.payerNamePlaceholder')}
                      value={formData.guardianName}
                      onChange={(e) => setFormData({ ...formData, guardianName: e.target.value })}
                      className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">{t('academic.guardians.colRelationship')}</label>
                  <select
                    value={formData.guardianRelationship}
                    onChange={(e) => setFormData({ ...formData, guardianRelationship: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 outline-none text-slate-900 dark:text-white"
                  >
                    <option value="Father">{t('academic.guardians.relationships.Father')}</option>
                    <option value="Mother">{t('academic.guardians.relationships.Mother')}</option>
                    <option value="Responsible">{t('academic.guardians.relationships.Responsible')}</option>
                  </select>
                </div>

                {/* Real-time status indicator banner */}
                {foundGuardian && (
                  <div className="mt-3 p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center gap-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
                    <div className="flex-1 min-w-0">
                      <div>
                        <span className="font-bold">{t('students.existingPayerFound')}</span> {foundGuardian.fullName} ({foundGuardian.relationship ? t(`academic.guardians.relationships.${foundGuardian.relationship}`, { defaultValue: tv(foundGuardian.relationship) }) : t('students.payer')}). {t('students.reusingRecord')}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-300 flex-wrap">
                        {foundGuardian.phone && (
                          <span>{t('academic.guardians.phone1')}: <strong className="font-bold underline">{foundGuardian.phone}</strong></span>
                        )}
                        {foundGuardian.alternatePhone && (
                          <span>{t('academic.guardians.phone2')}: <strong className="font-bold underline">{foundGuardian.alternatePhone}</strong></span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {!foundGuardian && isValidSomaliMobile(digitsOnly(formData.guardianPhone || formData.guardianAlternatePhone)) && !isSearchingGuardian && (
                  <div className="mt-3 p-3.5 rounded-2xl bg-brand-500/10 border border-brand-500/30 flex items-center gap-3 text-xs font-semibold text-brand-700 dark:text-brand-300">
                    <UserPlus size={18} className="shrink-0 text-brand-500" />
                    <div>
                      <span className="font-bold">{t('students.newPayer')}</span> {t('students.newPayerHint')}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-6 py-3 rounded-xl bg-emerald-600 text-white font-bold text-xs uppercase shadow-lg hover:bg-emerald-700"
                >
                  {editingItem ? t('common.saveChanges') : t('students.register')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <IdCard
        open={Boolean(cardStudent)}
        onClose={() => setCardStudent(null)}
        kind="student"
        name={cardStudent?.fullName}
        idNumber={cardStudent?.studentCode}
        rows={[
          { label: t('common.class'), value: classLabel(cardStudent?.classId, '') },
          { label: t('common.guardian'), value: cardStudent?.guardianId?.fullName || cardStudent?.fatherName || '' }
        ]}
      />

      {/* Exit Student confirmation modal */}
      {exitingStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm" onClick={() => !exitSaving && setExitingStudent(null)}>
          <div className="w-full max-w-md rounded-[28px] border border-slate-100 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900" onClick={e => e.stopPropagation()}>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400">
                <LogOut size={22} />
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">{t('students.exitStudent')}</h3>
                <p className="text-xs font-semibold text-slate-400">{t('students.exitHint')}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                  <span className="text-[10px] font-black uppercase text-slate-400">{t('students.studentName')}</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white">{exitingStudent.fullName}</p>
                </div>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 dark:bg-slate-800">
                  <span className="text-[10px] font-black uppercase text-slate-400">{t('students.colStudentId')}</span>
                  <p className="text-sm font-bold text-slate-900 dark:text-white font-mono">{exitingStudent.studentCode || exitingStudent.rollNumber || '—'}</p>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">{t('academic.exit.exitDate')}</label>
                <input
                  type="date"
                  value={exitDate}
                  onChange={e => setExitDate(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-900 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[10px] font-black uppercase text-slate-400">{t('academic.exit.reason')}</label>
                <textarea
                  rows={3}
                  value={exitReason}
                  onChange={e => setExitReason(e.target.value)}
                  placeholder={t('students.exitPlaceholder')}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900 outline-none focus:border-amber-400 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setExitingStudent(null)}
                disabled={exitSaving}
                className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirmExit}
                disabled={exitSaving}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-600 px-4 py-3 text-sm font-black uppercase tracking-wider text-white shadow-md transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LogOut size={15} /> {exitSaving ? t('students.exiting') : t('students.confirmExit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentsManagement;
