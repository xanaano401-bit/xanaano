import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users,
  Plus,
  Search,
  Phone,
  DollarSign,
  UserCheck,
  Edit2,
  Trash2,
  X,
  User,
  IdCard as IdCardIcon,
  Printer,
  CheckCircle2,
  AlertCircle,
  Clock,
  Filter,
  Download,
  Upload,
  FileSpreadsheet,
  Building2,
  Briefcase,
  Loader2
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import api from '../services/api';
import { useAlert } from '../components/common/alerts/useAlert';
import IdCard from '../components/IdCard.jsx';
import { useLanguage } from '../i18n/LanguageContext.jsx';
import { currentCycle, cycleLabel, cycleKeyForDate } from '../utils/billingCycle';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const loadExcelJS = async () => (await import('exceljs')).default;

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
  header.height = 24;
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
};

const SHEET_COLUMNS = [
  { header: 'Employee ID', key: 'employeeId', width: 16 },
  { header: 'Employee Name', key: 'fullName', width: 28 },
  { header: 'Employee Number', key: 'phone', width: 18 },
  { header: 'Employee Guardian Name', key: 'masuulName', width: 24 },
  { header: 'Employee Guardian Number', key: 'masuulNumber', width: 20 },
  { header: 'Gender', key: 'gender', width: 12 },
  { header: 'Employee Title', key: 'jobTitle', width: 22 },
  { header: 'Employee Salary', key: 'salary', width: 16 },
  { header: 'Branch', key: 'branchName', width: 20 }
];

const COLUMN_ALIASES = {
  employeeId: ['employee id', 'id', 'employee code', 'teacher code', 'code', 'aqoonsiga shaqaalaha', 'aqoonsi'],
  fullName: ['employee name', 'name', 'magaca shaqaalaha', 'magaca oo buuxa', 'full name', 'magac'],
  phone: ['employee number', 'phone', 'phone number', 'telefoonka shaqaalaha', 'numberka shaqaalaha', 'telefoon', 'lambar'],
  masuulName: ['employee guardian name', 'guardian name', 'masuul name', 'magaca masuulka', 'masuul'],
  masuulNumber: ['employee guardian number', 'guardian phone', 'masuul number', 'numberka masuulka', 'telefoonka masuulka'],
  gender: ['gender', 'jinsiga', 'sex'],
  jobTitle: ['employee title', 'title', 'job title', 'role', 'xilka shaqaalaha', 'xilka', 'booska', 'shaqada'],
  salary: ['employee salary', 'salary', 'monthly salary', 'mushaharka', 'mushahar', 'mushaharka bishii'],
  branchName: ['branch', 'branch name', 'xarunta', 'laanta', 'magaca xarunta', 'campus']
};

const headerAliases = (column) => {
  const extras = COLUMN_ALIASES[column.key] || [];
  return [column.header.toLowerCase(), ...extras].map(h => String(h || '').toLowerCase().trim());
};

const TeachersManagement = () => {
  const { showAlert, showConfirm } = useAlert();
  const { t: tr, tv, locale } = useLanguage();
  const [teachers, setTeachers] = useState([]);
  const [salaries, setSalaries] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cardTeacher, setCardTeacher] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [genderFilter, setGenderFilter] = useState('All');
  const [salaryFilter, setSalaryFilter] = useState('all'); // 'all' | 'paid' | 'pending'
  const [branchFilter, setBranchFilter] = useState('All');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);

  const [tenantInfo, setTenantInfo] = useState(() => {
    try {
      const saved = localStorage.getItem('tenant_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          name: parsed.name || 'Salaaxu–Aldaareyn',
          subtitle: parsed.systemSubtitle || 'Institute Management'
        };
      }
    } catch (_) {}
    return { name: 'Salaaxu–Aldaareyn', subtitle: 'Institute Management' };
  });

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get('/settings');
        setTenantInfo({
          name: data?.name || 'Salaaxu–Aldaareyn',
          subtitle: data?.systemSubtitle || 'Institute Management'
        });
      } catch (_) {}
    })();
  }, []);

  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    gender: 'Male',
    jobTitle: 'Teacher',
    salary: '',
    masuulName: '',
    masuulNumber: '',
    branchId: '',
    teacherCode: ''
  });

  const fetchTeachers = async () => {
    try {
      setLoading(true);
      const [teachersRes, salariesRes, branchesRes] = await Promise.allSettled([
        api.get('/users?role=Teacher'),
        api.get('/salaries'),
        api.get('/branches')
      ]);

      if (teachersRes.status === 'fulfilled' && Array.isArray(teachersRes.value.data)) {
        setTeachers(teachersRes.value.data);
      } else {
        setTeachers([]);
      }

      if (salariesRes.status === 'fulfilled' && Array.isArray(salariesRes.value.data)) {
        setSalaries(salariesRes.value.data);
      } else {
        setSalaries([]);
      }

      if (branchesRes.status === 'fulfilled' && Array.isArray(branchesRes.value.data)) {
        setBranches(branchesRes.value.data);
      } else {
        setBranches([]);
      }
    } catch (error) {
      console.error('Failed to fetch employees:', error);
      showAlert({
        type: 'danger',
        title: tr('common.error'),
        message: tr('academic.teachers.loadFailed')
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeachers();
  }, []);

  const teacherIdOfSalary = (s) => {
    if (!s) return null;
    if (typeof s.teacherId === 'object' && s.teacherId?._id) {
      return String(s.teacherId._id);
    }
    return String(s.teacherId || '');
  };

  const salaryBelongsToCycle = (s, cycleKey) => {
    if (!s) return false;
    if (s.billingCycle) return s.billingCycle === cycleKey;
    if (s.month && /^\d{4}-\d{2}$/.test(s.month)) return s.month === cycleKey;
    if (s.paymentDate) return cycleKeyForDate(s.paymentDate) === cycleKey;
    if (s.createdAt) return cycleKeyForDate(s.createdAt) === cycleKey;
    return false;
  };

  const activeCycle = currentCycle();

  const teachersWithSalary = useMemo(() => {
    return teachers.map((t) => {
      const salary = Number(t.salary) || 0;
      const teacherSalaries = salaries.filter((s) => {
        const matchT = teacherIdOfSalary(s) === String(t._id);
        const matchC = salaryBelongsToCycle(s, activeCycle);
        const isPaid = s.status === 'Paid';
        return matchT && matchC && isPaid;
      });
      const paid = teacherSalaries.reduce((sum, s) => sum + (Number(s.amount) || 0), 0);
      const remaining = salary > 0 ? Math.max(0, salary - paid) : 0;

      let paymentStatus = 'none';
      if (salary > 0) {
        if (paid >= salary) paymentStatus = 'paid';
        else if (paid > 0) paymentStatus = 'partial';
        else paymentStatus = 'pending';
      }

      return {
        ...t,
        paid,
        remaining,
        paymentStatus
      };
    });
  }, [teachers, salaries, activeCycle]);

  const stats = useMemo(() => {
    const total = teachersWithSalary.length;
    const maleCount = teachersWithSalary.filter(t => t.gender === 'Male').length;
    const femaleCount = teachersWithSalary.filter(t => t.gender === 'Female').length;
    const totalSalary = teachersWithSalary.reduce((sum, t) => sum + (Number(t.salary) || 0), 0);
    const totalPaid = teachersWithSalary.reduce((sum, t) => sum + (Number(t.paid) || 0), 0);
    const totalRemaining = teachersWithSalary.reduce((sum, t) => sum + (Number(t.remaining) || 0), 0);
    const paidCount = teachersWithSalary.filter(t => t.paid > 0).length;
    const pendingCount = teachersWithSalary.filter(t => t.salary > 0 && t.remaining > 0).length;

    return {
      total,
      maleCount,
      femaleCount,
      totalSalary,
      totalPaid,
      totalRemaining,
      paidCount,
      pendingCount
    };
  }, [teachersWithSalary]);

  const filteredTeachers = useMemo(() => {
    return teachersWithSalary.filter(t => {
      const matchesSearch =
        t.fullName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.phone?.includes(searchTerm) ||
        t.jobTitle?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        t.teacherCode?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesGender =
        genderFilter === 'All' || t.gender === genderFilter;

      let matchesSalary = true;
      if (salaryFilter === 'paid') {
        matchesSalary = t.paid > 0;
      } else if (salaryFilter === 'pending') {
        matchesSalary = t.salary > 0 && t.remaining > 0;
      }

      let matchesBranch = true;
      if (branchFilter !== 'All') {
        const bId = t.branchId?._id || t.branchId;
        matchesBranch = bId === branchFilter;
      }

      return matchesSearch && matchesGender && matchesSalary && matchesBranch;
    });
  }, [teachersWithSalary, searchTerm, genderFilter, salaryFilter, branchFilter]);

  const filteredTotals = useMemo(() => {
    return filteredTeachers.reduce((acc, t) => {
      acc.salary += Number(t.salary) || 0;
      acc.paid += Number(t.paid) || 0;
      acc.remaining += Number(t.remaining) || 0;
      return acc;
    }, { salary: 0, paid: 0, remaining: 0 });
  }, [filteredTeachers]);

  // ── Excel Export ──────────────────────────────────────────────────────────
  const handleExportExcel = async () => {
    try {
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(locale === 'so' ? 'Shaqaalaha' : 'Employees');
      sheet.columns = SHEET_COLUMNS;
      styleHeaderRow(sheet);

      filteredTeachers.forEach((t) => {
        const branchObj = t.branchId && typeof t.branchId === 'object'
          ? t.branchId
          : branches.find(b => b._id === t.branchId);

        sheet.addRow({
          employeeId: t.teacherCode || '',
          fullName: t.fullName || '',
          phone: t.phone || '',
          masuulName: t.masuulName || '',
          masuulNumber: t.masuulNumber || '',
          gender: tv(t.gender || 'Male'),
          jobTitle: t.jobTitle || 'Teacher',
          salary: Number(t.salary) || 0,
          branchName: branchObj?.name || ''
        });
      });

      ['phone', 'masuulNumber'].forEach(key => {
        const col = sheet.getColumn(key);
        if (col) col.numFmt = '@';
      });

      const fileName = `Employees_${new Date().toISOString().slice(0, 10)}.xlsx`;
      await downloadWorkbook(workbook, fileName);

      showAlert({
        type: 'success',
        title: tr('academic.teachers.exportExcel') || 'Export complete',
        message: `${filteredTeachers.length} employees exported successfully.`
      });
    } catch (err) {
      console.error('Failed to export Excel:', err);
      showAlert({
        type: 'danger',
        title: tr('common.error'),
        message: 'Failed to export Excel file.'
      });
    }
  };

  // ── Excel Template ────────────────────────────────────────────────────────
  const handleDownloadTemplate = async () => {
    try {
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(locale === 'so' ? 'Shaqaalaha' : 'Employees');
      sheet.columns = SHEET_COLUMNS;
      styleHeaderRow(sheet);

      sheet.addRow({
        employeeId: 'EMP-2026-0001',
        fullName: 'Axmed Cali Xasan',
        phone: '0615551234',
        masuulName: 'Cali Xasan Maxamed',
        masuulNumber: '0615559876',
        gender: 'Male',
        jobTitle: 'Macallin',
        salary: 250,
        branchName: branches[0]?.name || 'Main Branch'
      });
      sheet.getRow(2).font = { italic: true, color: { argb: 'FF94A3B8' } };

      const notes = workbook.addWorksheet(locale === 'so' ? 'Tilmaamaha' : 'Instructions');
      notes.columns = [{ width: 100 }];
      const instructions = locale === 'so' ? [
        'SIDA LOO ISTICMAALO QAABKA SOO GELINTA SHAQAALAHA (EMPLOYEE)',
        '',
        '1. Hal saf = Hal shaqaale. Safka tusaalaha ah ee cawlan waad tirtiri kartaa ka hor soo gelinta.',
        '2. Employee ID: Waad ka tagi kartaa madhan haddii aad rabto in nidaamku si toos ah u bixiyo (EMP-...).',
        '3. Employee Name: Magaca oo buuxa ee shaqaalaha (Qasab ah).',
        '4. Employee Number: Lambarka telefoonka ee shaqaalaha.',
        '5. Employee Guardian Name: Magaca qofka masuulka ka ah shaqaalaha.',
        '6. Employee Guardian Number: Lambarka telefoonka ee masuulka.',
        '7. Gender: Male (Lab) ama Female (Dheddig).',
        '8. Employee Title: Xilka / Booska shaqaalaha (Macallin, Daryeele, Karariye, Nadaafad, Ilaaliye, iwm).',
        '9. Employee Salary: Mushaharka bishii (Tusaale: 250).',
        '10. Branch: Magaca xarunta ama laanta uu ka tirsan yahay.'
      ] : [
        'HOW TO USE THE EMPLOYEE IMPORT TEMPLATE',
        '',
        '1. One row = one employee. Delete or overwrite the grey sample row.',
        '2. Employee ID: Leave blank for auto-generation (EMP-...) or specify custom ID.',
        '3. Employee Name: Full name of employee (Required).',
        '4. Employee Number: Mobile phone number.',
        '5. Employee Guardian Name: Guardian / Contact person name.',
        '6. Employee Guardian Number: Guardian phone number.',
        '7. Gender: Male or Female.',
        '8. Employee Title: Job role (Teacher, Caregiver, Cook, Cleaner, Driver, Admin, etc).',
        '9. Employee Salary: Monthly salary amount (e.g. 250).',
        '10. Branch: Name of campus or branch.'
      ];

      instructions.forEach(line => notes.addRow([line]));
      notes.getRow(1).font = { bold: true, size: 12 };

      await downloadWorkbook(workbook, 'Employee_Import_Template.xlsx');
      showAlert({
        type: 'success',
        title: tr('academic.teachers.excelTemplate') || 'Template downloaded',
        message: 'Employee template downloaded successfully.'
      });
    } catch (err) {
      console.error('Failed to download template:', err);
      showAlert({
        type: 'danger',
        title: tr('common.error'),
        message: 'Failed to download template.'
      });
    }
  };

  // ── Excel Import ──────────────────────────────────────────────────────────
  const handleImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';

    setImporting(true);
    try {
      const ExcelJS = await loadExcelJS();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const sheet = workbook.getWorksheet(locale === 'so' ? 'Shaqaalaha' : 'Employees') || workbook.worksheets[0];
      if (!sheet) throw new Error('No sheets found in Excel file');

      const headerRow = sheet.getRow(1);
      const indexByHeader = {};
      headerRow.eachCell((cell, col) => {
        const val = cellText(cell.value).toLowerCase();
        const match = SHEET_COLUMNS.find(c => headerAliases(c).includes(val));
        if (match) indexByHeader[match.key] = col;
      });

      if (indexByHeader.fullName === undefined) {
        throw new Error('Could not find "Employee Name" column in Excel sheet');
      }

      const rows = [];
      sheet.eachRow((excelRow, rowNumber) => {
        if (rowNumber === 1) return;
        const row = {};
        SHEET_COLUMNS.forEach(({ key }) => {
          const col = indexByHeader[key];
          row[key] = col ? cellText(excelRow.getCell(col).value) : '';
        });
        if (!row.fullName || row.fullName.toLowerCase().includes('axmed cali') || row.employeeId === 'EMP-2026-0001') return;
        rows.push({ ...row, rowNumber });
      });

      if (!rows.length) {
        setImporting(false);
        showAlert({
          type: 'warning',
          title: 'No Data',
          message: 'No valid employee rows found in the uploaded file.'
        });
        return;
      }

      let imported = 0;
      let skipped = 0;

      for (const row of rows) {
        try {
          let branchId = undefined;
          if (row.branchName) {
            const matchedBranch = branches.find(b =>
              b.name?.toLowerCase().trim() === row.branchName.toLowerCase().trim()
            );
            if (matchedBranch) branchId = matchedBranch._id;
          }
          if (!branchId && branches.length > 0) {
            branchId = branches[0]._id;
          }

          const rawGender = String(row.gender || '').toLowerCase();
          const cleanGender = rawGender.includes('fe') || rawGender.includes('dh') ? 'Female' : 'Male';

          await api.post('/users', {
            fullName: row.fullName.trim(),
            username: row.fullName.trim(),
            phone: row.phone ? String(row.phone).trim() : '',
            gender: cleanGender,
            role: 'Teacher',
            jobTitle: row.jobTitle ? row.jobTitle.trim() : 'Teacher',
            salary: Number(row.salary) || 0,
            masuulName: row.masuulName ? row.masuulName.trim() : '',
            masuulNumber: row.masuulNumber ? row.masuulNumber.trim() : '',
            branchId,
            employeeCode: row.employeeId ? row.employeeId.trim() : undefined,
            teacherCode: row.employeeId ? row.employeeId.trim() : undefined
          });
          imported++;
        } catch (rowErr) {
          console.warn('Row skipped:', rowErr);
          skipped++;
        }
      }

      showAlert({
        type: imported > 0 ? 'success' : 'warning',
        title: tr('academic.teachers.importResult') || 'Import Result',
        message: `${imported} imported · ${skipped} skipped · ${rows.length} total rows`
      });

      fetchTeachers();
    } catch (err) {
      console.error('Import failed:', err);
      showAlert({
        type: 'danger',
        title: tr('common.error'),
        message: err.message || 'Failed to import Excel file.'
      });
    } finally {
      setImporting(false);
    }
  };

  // ── PDF Export ────────────────────────────────────────────────────────────
  const handleExportPDF = () => {
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const pageH = doc.internal.pageSize.getHeight();

      doc.setFillColor(15, 23, 42);
      doc.rect(14, 12, pageW - 28, 22, 'F');

      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.text(tenantInfo.name.toUpperCase(), pageW / 2, 20, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      const titleText = locale === 'so' ? 'WARBIXINTA GUUD EE SHAQAALAHA' : 'EMPLOYEE SALARY & DIRECTORY REPORT';
      doc.text(titleText, pageW / 2, 26, { align: 'center' });

      doc.setFontSize(7.5);
      doc.setTextColor(203, 213, 225);
      doc.text(`${cycleLabel(activeCycle, locale)}  |  ${new Date().toLocaleDateString(locale === 'so' ? 'so-SO' : 'en-US')}`, pageW / 2, 31, { align: 'center' });

      let y = 42;
      const cols = {
        no: { x: 14, w: 10 },
        name: { x: 24, w: 42 },
        title: { x: 66, w: 28 },
        phone: { x: 94, w: 26 },
        branch: { x: 120, w: 24 },
        salary: { x: 144, w: 18 },
        paid: { x: 162, w: 17 },
        remaining: { x: 179, w: 17 }
      };

      doc.setFillColor(241, 245, 249);
      doc.rect(14, y - 4, pageW - 28, 7, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);

      doc.text('#', cols.no.x + 5, y, { align: 'center' });
      doc.text(locale === 'so' ? 'MAGACA SHAQAALAHA' : 'EMPLOYEE NAME', cols.name.x + 2, y);
      doc.text(locale === 'so' ? 'XILKA' : 'TITLE', cols.title.x + 2, y);
      doc.text(locale === 'so' ? 'TELEFOONKA' : 'PHONE', cols.phone.x + 2, y);
      doc.text(locale === 'so' ? 'XARUNTA' : 'BRANCH', cols.branch.x + 2, y);
      doc.text(locale === 'so' ? 'MUSHAHAR' : 'SALARY', cols.salary.x + cols.salary.w - 2, y, { align: 'right' });
      doc.text(locale === 'so' ? 'BIXIYEY' : 'PAID', cols.paid.x + cols.paid.w - 2, y, { align: 'right' });
      doc.text(locale === 'so' ? 'DHIMAN' : 'REMAIN', cols.remaining.x + cols.remaining.w - 2, y, { align: 'right' });

      y += 6;

      filteredTeachers.forEach((t, i) => {
        if (y > pageH - 18) {
          doc.addPage();
          y = 16;
        }

        if (i % 2 === 1) {
          doc.setFillColor(248, 250, 252);
          doc.rect(14, y - 3.8, pageW - 28, 6, 'F');
        }

        const branchObj = t.branchId && typeof t.branchId === 'object'
          ? t.branchId
          : branches.find(b => b._id === t.branchId);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(51, 65, 85);

        doc.text(String(i + 1), cols.no.x + 5, y, { align: 'center' });
        doc.setFont('helvetica', 'bold');
        doc.text((t.fullName || '').slice(0, 24), cols.name.x + 2, y);
        doc.setFont('helvetica', 'normal');
        doc.text((t.jobTitle || 'Teacher').slice(0, 16), cols.title.x + 2, y);
        doc.text(t.phone || '—', cols.phone.x + 2, y);
        doc.text((branchObj?.name || '—').slice(0, 14), cols.branch.x + 2, y);

        doc.setFont('helvetica', 'bold');
        doc.text(`$${(Number(t.salary) || 0).toLocaleString()}`, cols.salary.x + cols.salary.w - 2, y, { align: 'right' });
        doc.setTextColor(5, 150, 105);
        doc.text(`$${(Number(t.paid) || 0).toLocaleString()}`, cols.paid.x + cols.paid.w - 2, y, { align: 'right' });
        doc.setTextColor(Number(t.remaining) > 0 ? 225 : 100, Number(t.remaining) > 0 ? 29 : 116, Number(t.remaining) > 0 ? 72 : 139);
        doc.text(`$${(Number(t.remaining) || 0).toLocaleString()}`, cols.remaining.x + cols.remaining.w - 2, y, { align: 'right' });

        y += 6;
      });

      // Bottom Summary Row
      if (y > pageH - 20) {
        doc.addPage();
        y = 16;
      }

      doc.setFillColor(241, 245, 249);
      doc.rect(14, y - 4, pageW - 28, 7.5, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);

      doc.text(`${locale === 'so' ? 'WADARTA GUUD' : 'TOTAL'} (${filteredTeachers.length})`, cols.name.x + 2, y);
      doc.text(`$${filteredTotals.salary.toLocaleString()}`, cols.salary.x + cols.salary.w - 2, y, { align: 'right' });
      doc.setTextColor(5, 150, 105);
      doc.text(`$${filteredTotals.paid.toLocaleString()}`, cols.paid.x + cols.paid.w - 2, y, { align: 'right' });
      doc.setTextColor(225, 29, 72);
      doc.text(`$${filteredTotals.remaining.toLocaleString()}`, cols.remaining.x + cols.remaining.w - 2, y, { align: 'right' });

      doc.save(`Employees_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error('Failed to export PDF:', err);
      showAlert({
        type: 'danger',
        title: tr('common.error'),
        message: 'Error generating PDF report'
      });
    }
  };

  const handleOpenAdd = () => {
    setEditingTeacher(null);
    setFormData({
      fullName: '',
      phone: '',
      gender: 'Male',
      jobTitle: 'Teacher',
      salary: '',
      masuulName: '',
      masuulNumber: '',
      branchId: branches[0]?._id || '',
      teacherCode: ''
    });
    setIsModalOpen(true);
  };

  const handleOpenEdit = (teacher) => {
    setEditingTeacher(teacher);
    setFormData({
      fullName: teacher.fullName || teacher.username || '',
      phone: teacher.phone || '',
      gender: teacher.gender || 'Male',
      jobTitle: teacher.jobTitle || 'Teacher',
      salary: teacher.salary ? String(teacher.salary) : '',
      masuulName: teacher.masuulName || '',
      masuulNumber: teacher.masuulNumber || '',
      branchId: teacher.branchId?._id || teacher.branchId || branches[0]?._id || '',
      teacherCode: teacher.teacherCode || ''
    });
    setIsModalOpen(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.fullName.trim()) {
      showAlert({
        type: 'warning',
        title: tr('common.validationError'),
        message: tr('academic.teachers.nameRequired') || 'Employee Name is required'
      });
      return;
    }

    try {
      setSubmitting(true);
      const payload = {
        fullName: formData.fullName.trim(),
        username: formData.fullName.trim(),
        phone: formData.phone.trim(),
        gender: formData.gender,
        role: 'Teacher',
        jobTitle: (formData.jobTitle || 'Teacher').trim(),
        salary: Number(formData.salary) || 0,
        masuulName: formData.masuulName.trim(),
        masuulNumber: formData.masuulNumber.trim(),
        branchId: formData.branchId || undefined,
        teacherCode: formData.teacherCode ? formData.teacherCode.trim() : undefined,
        employeeCode: formData.teacherCode ? formData.teacherCode.trim() : undefined
      };

      if (editingTeacher) {
        await api.put(`/users/${editingTeacher._id}`, payload);
        showAlert({
          type: 'success',
          title: tr('academic.teachers.updatedTitle') || 'Updated',
          message: tr('academic.teachers.updated') || 'Employee updated successfully.'
        });
      } else {
        await api.post('/users', payload);
        showAlert({
          type: 'success',
          title: tr('academic.teachers.registeredTitle') || 'Registered',
          message: tr('academic.teachers.registered') || 'New Employee registered successfully.'
        });
      }

      setIsModalOpen(false);
      fetchTeachers();
    } catch (error) {
      console.error('Failed to save employee:', error);
      showAlert({
        type: 'danger',
        title: tr('common.error'),
        message: error.response?.data?.message || tr('academic.teachers.saveFailed') || 'Failed to save employee.'
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (teacher) => {
    showConfirm({
      title: tr('academic.teachers.deleteTitle') || 'Delete Employee?',
      message: (tr('academic.teachers.deleteConfirm') || 'Are you sure you want to delete {name}?').replace('{name}', teacher.fullName || teacher.username),
      confirmText: tr('academic.teachers.yesDelete') || 'Yes, Delete',
      confirmVariant: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/users/${teacher._id}`);
          showAlert({
            type: 'success',
            title: tr('common.deleted'),
            message: tr('academic.teachers.deletedMsg') || 'Employee deleted successfully.'
          });
          fetchTeachers();
        } catch (error) {
          console.error('Failed to delete employee:', error);
          showAlert({
            type: 'danger',
            title: tr('common.error'),
            message: error.response?.data?.message || tr('academic.teachers.deleteFailed') || 'Failed to delete employee.'
          });
        }
      }
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Hidden File Input for Excel Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />

      {/* Header Banner */}
      <div className="rounded-[32px] p-8 bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 text-white shadow-xl relative overflow-hidden border border-slate-700/40">
        <div className="absolute -right-10 -bottom-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-300 text-xs font-bold border border-indigo-500/30">
              <Users size={14} />
              <span>{tr('academic.teachers.title') || 'Employee Management'}</span>
            </div>
            <h1 className="text-3xl font-black tracking-tight text-white">
              {tr('academic.teachers.title') || 'Employee Management'}
            </h1>
            <p className="text-sm text-slate-300 max-w-xl">
              {tr('academic.teachers.subtitle') || 'Staff Directory & Employee Registration'}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={handleDownloadTemplate}
              className="px-3.5 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-2 transition-all"
              title="Download Excel Template"
            >
              <FileSpreadsheet size={15} className="text-emerald-400" />
              <span>{tr('academic.teachers.excelTemplate') || 'Qaabka Excel'}</span>
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="px-3.5 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-2 transition-all"
              title="Import Excel"
            >
              {importing ? <Loader2 size={15} className="animate-spin text-blue-400" /> : <Upload size={15} className="text-blue-400" />}
              <span>{tr('academic.teachers.importExcel') || 'Soo Geli Excel'}</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="px-3.5 py-2.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-900/30 transition-all"
              title="Export to Excel"
            >
              <Download size={15} />
              <span>{tr('academic.teachers.exportExcel') || 'Dhoofi Excel'}</span>
            </button>

            <button
              onClick={handleExportPDF}
              className="px-3.5 py-2.5 rounded-2xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-bold border border-slate-700 flex items-center gap-2 transition-all"
              title="Export to PDF"
            >
              <Printer size={15} />
              <span>PDF</span>
            </button>

            <button
              onClick={handleOpenAdd}
              className="px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-lg shadow-indigo-900/40 transition-all"
            >
              <Plus size={16} strokeWidth={3} />
              <span>{tr('academic.teachers.registerNew') || 'Ku Dar Shaqaale'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
            {tr('academic.teachers.total') || 'Total Employees'}
          </span>
          <span className="text-2xl font-black text-slate-900 dark:text-white">
            {stats.total}
          </span>
          <div className="flex items-center gap-3 text-xs text-slate-400 mt-2">
            <span>Lab: <strong className="text-slate-700 dark:text-slate-300">{stats.maleCount}</strong></span>
            <span>•</span>
            <span>Dheddig: <strong className="text-slate-700 dark:text-slate-300">{stats.femaleCount}</strong></span>
          </div>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-1">
            {tr('academic.teachers.payroll') || 'Total Payroll'}
          </span>
          <span className="text-2xl font-black text-slate-900 dark:text-white">
            ${stats.totalSalary.toLocaleString()}
          </span>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {cycleLabel(activeCycle, locale)}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-1">
            {locale === 'so' ? 'La Bixiyey' : 'Paid'}
          </span>
          <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">
            ${stats.totalPaid.toLocaleString()}
          </span>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {stats.paidCount} {locale === 'so' ? 'shaqaale ayaa qaatay' : 'paid'}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400 block mb-1">
            {locale === 'so' ? 'Dhiman' : 'Remaining'}
          </span>
          <span className="text-2xl font-black text-rose-600 dark:text-rose-400">
            ${stats.totalRemaining.toLocaleString()}
          </span>
          <p className="text-xs text-slate-400 mt-2 font-medium">
            {stats.pendingCount} {locale === 'so' ? 'shaqaale ayaa dhiman' : 'pending'}
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
          <input
            type="text"
            placeholder={tr('academic.teachers.searchPlaceholder') || 'Search by name, title, phone, or ID...'}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Branch Filter */}
          {branches.length > 1 && (
            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
            >
              <option value="All">{locale === 'so' ? 'Dhammaan Xarumaha' : 'All Branches'}</option>
              {branches.map(b => (
                <option key={b._id} value={b._id}>{b.name}</option>
              ))}
            </select>
          )}

          {/* Gender Filter */}
          <select
            value={genderFilter}
            onChange={(e) => setGenderFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
          >
            <option value="All">{locale === 'so' ? 'Dhammaan Jinsiga' : 'All Gender'}</option>
            <option value="Male">{tv('Male')}</option>
            <option value="Female">{tv('Female')}</option>
          </select>

          {/* Salary Filter */}
          <select
            value={salaryFilter}
            onChange={(e) => setSalaryFilter(e.target.value)}
            className="px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border-none text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
          >
            <option value="all">{locale === 'so' ? 'Mushahar: Dhammaan' : 'Salary: All'}</option>
            <option value="paid">{locale === 'so' ? 'Kaliya Kuwa Qaatay' : 'Only Paid'}</option>
            <option value="pending">{locale === 'so' ? 'Kaliya Kuwa Dhiman' : 'Only Pending'}</option>
          </select>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-[10px] font-black uppercase tracking-wider text-slate-400">
                <th className="px-6 py-4"># / ID</th>
                <th className="px-6 py-4">{tr('academic.teachers.colName') || 'Employee Name'}</th>
                <th className="px-6 py-4">{tr('academic.teachers.colTitle') || 'Title / Role'}</th>
                <th className="px-6 py-4">{tr('academic.teachers.colPhone') || 'Phone Number'}</th>
                <th className="px-6 py-4">{tr('academic.teachers.colMasuul') || 'Guardian / Masuul'}</th>
                <th className="px-6 py-4">{tr('academic.teachers.colBranch') || 'Branch'}</th>
                <th className="px-6 py-4 text-right">{tr('academic.teachers.colSalary') || 'Salary'}</th>
                <th className="px-6 py-4 text-center">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 text-xs">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    <Loader2 size={24} className="animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>{tr('academic.teachers.loading') || 'Loading employee records...'}</span>
                  </td>
                </tr>
              ) : filteredTeachers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-400">
                    <Users size={32} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    <p className="font-bold">{tr('academic.teachers.empty') || 'No employees found.'}</p>
                  </td>
                </tr>
              ) : (
                filteredTeachers.map((t, idx) => {
                  const branchObj = t.branchId && typeof t.branchId === 'object'
                    ? t.branchId
                    : branches.find(b => b._id === t.branchId);

                  return (
                    <tr key={t._id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                      {/* ID */}
                      <td className="px-6 py-4 font-mono font-bold text-[11px] text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800/60">
                          {t.teacherCode || `#${idx + 1}`}
                        </span>
                      </td>

                      {/* Name & Gender */}
                      <td className="px-6 py-4">
                        <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                          <span>{t.fullName}</span>
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                            t.gender === 'Female'
                              ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400'
                              : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400'
                          }`}>
                            {t.gender === 'Female' ? 'D' : 'L'}
                          </span>
                        </div>
                      </td>

                      {/* Job Title */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                          <Briefcase size={12} className="text-slate-400" />
                          {t.jobTitle || 'Teacher'}
                        </span>
                      </td>

                      {/* Phone */}
                      <td className="px-6 py-4 font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {t.phone ? (
                          <a href={`tel:${t.phone}`} className="hover:text-indigo-600 flex items-center gap-1.5 font-semibold">
                            <Phone size={12} className="text-slate-400" />
                            {t.phone}
                          </a>
                        ) : '—'}
                      </td>

                      {/* Guardian */}
                      <td className="px-6 py-4">
                        {t.masuulName || t.masuulNumber ? (
                          <div className="text-xs">
                            <span className="font-semibold text-slate-800 dark:text-slate-200 block truncate max-w-[150px]">
                              {t.masuulName || '—'}
                            </span>
                            {t.masuulNumber && (
                              <span className="font-mono text-[11px] text-slate-400">
                                {t.masuulNumber}
                              </span>
                            )}
                          </div>
                        ) : '—'}
                      </td>

                      {/* Branch */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-300">
                          <Building2 size={12} className="text-slate-400" />
                          {branchObj?.name || '—'}
                        </span>
                      </td>

                      {/* Salary */}
                      <td className="px-6 py-4 text-right font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        ${(Number(t.salary) || 0).toLocaleString()}
                      </td>

                      {/* Payment Status */}
                      <td className="px-6 py-4 text-center whitespace-nowrap">
                        {t.paymentStatus === 'paid' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/60">
                            <CheckCircle2 size={11} /> {locale === 'so' ? 'Bixiyey' : 'Paid'}
                          </span>
                        )}
                        {t.paymentStatus === 'partial' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
                            <Clock size={11} /> {locale === 'so' ? 'Qayb' : 'Partial'}
                          </span>
                        )}
                        {t.paymentStatus === 'pending' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200/60 dark:border-rose-800/60">
                            <AlertCircle size={11} /> {locale === 'so' ? 'Dhiman' : 'Pending'}
                          </span>
                        )}
                        {t.paymentStatus === 'none' && (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setCardTeacher(t)}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-indigo-50 text-slate-600 hover:text-indigo-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition-colors"
                            title={tr('academic.teachers.idCard') || 'ID Card'}
                          >
                            <IdCardIcon size={15} />
                          </button>
                          <button
                            onClick={() => handleOpenEdit(t)}
                            className="p-2 rounded-xl bg-slate-100 hover:bg-brand-50 text-slate-600 hover:text-brand-600 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-300 transition-colors"
                            title={tr('academic.teachers.editTitle') || 'Edit'}
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(t)}
                            className="p-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/30 dark:hover:bg-rose-900/50 dark:text-rose-400 transition-colors"
                            title={tr('academic.teachers.deleteButton') || 'Delete'}
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredTeachers.length > 0 && (
              <tfoot>
                <tr className="bg-slate-100/90 dark:bg-slate-800/90 font-black border-t-2 border-slate-900 dark:border-slate-700">
                  <td colSpan={6} className="px-6 py-4 font-black uppercase text-slate-900 dark:text-white">
                    {locale === 'so' ? 'WADARTA GUUD' : 'TOTAL'} ({filteredTeachers.length})
                  </td>
                  <td className="px-6 py-4 text-right font-black text-slate-900 dark:text-white">
                    ${filteredTotals.salary.toLocaleString()}
                  </td>
                  <td colSpan={2} className="px-6 py-4"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Add / Edit Employee Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-[32px] border border-slate-100 dark:border-slate-800 max-w-xl w-full p-8 shadow-2xl space-y-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center">
                  <Users size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                    {editingTeacher ? (tr('academic.teachers.editTitle') || 'Edit Employee') : (tr('academic.teachers.registerNew') || 'Register New Employee')}
                  </h3>
                  <p className="text-xs font-semibold text-slate-400">
                    {tr('academic.teachers.facultyInfo') || 'Employee Information'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Row 1: Employee Name & Employee Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.fullNameLabel') || 'Employee Name *'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={tr('academic.teachers.fullNamePlaceholder') || 'e.g. Hassan Ali'}
                    value={formData.fullName}
                    onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.phoneLabel') || 'Employee Number (Phone) *'}
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="0615551234"
                    value={formData.phone}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Row 2: Employee Title & Gender */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.titleLabel') || 'Employee Title / Role *'}
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={tr('academic.teachers.titlePlaceholder') || 'e.g. Macallin, Daryeele, Karariye...'}
                    value={formData.jobTitle}
                    onChange={e => setFormData({ ...formData, jobTitle: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.genderLabel') || 'Gender *'}
                  </label>
                  <select
                    value={formData.gender}
                    onChange={e => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="Male">{tv('Male')}</option>
                    <option value="Female">{tv('Female')}</option>
                  </select>
                </div>
              </div>

              {/* Row 3: Employee Guardian Name & Guardian Number */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.masuulName') || 'Employee Guardian Name'}
                  </label>
                  <input
                    type="text"
                    placeholder={locale === 'so' ? 'Magaca qofka masuulka ah' : 'Guardian full name'}
                    value={formData.masuulName}
                    onChange={e => setFormData({ ...formData, masuulName: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.masuulNumber') || 'Employee Guardian Number'}
                  </label>
                  <input
                    type="tel"
                    placeholder="0615559876"
                    value={formData.masuulNumber}
                    onChange={e => setFormData({ ...formData, masuulNumber: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Row 4: Salary & Branch */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.salaryLabel') || 'Employee Salary ($)'}
                  </label>
                  <div className="relative">
                    <DollarSign size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
                    <input
                      type="number"
                      placeholder="0.00"
                      value={formData.salary}
                      onChange={e => setFormData({ ...formData, salary: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                    {tr('academic.teachers.branchLabel') || 'Branch *'}
                  </label>
                  <select
                    value={formData.branchId}
                    onChange={e => setFormData({ ...formData, branchId: e.target.value })}
                    className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">{tr('academic.teachers.branchPlaceholder') || 'Select Branch'}</option>
                    {branches.map(b => (
                      <option key={b._id} value={b._id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 5: Custom Employee ID (Optional / Auto) */}
              <div>
                <label className="block text-xs font-black uppercase text-slate-500 mb-1">
                  {tr('academic.teachers.colId') || 'Employee ID'}
                  <span className="text-[10px] text-slate-400 font-normal ml-2">
                    ({locale === 'so' ? 'Haddii aad ka tagto madhan, nidaamka ayaa si toos ah u bixinaya' : 'Leave blank for auto-generation'})
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. EMP-2026-0001"
                  value={formData.teacherCode}
                  onChange={e => setFormData({ ...formData, teacherCode: e.target.value })}
                  className="w-full px-4 py-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-6 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs hover:bg-slate-200"
                >
                  {tr('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-8 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-indigo-900/30 transition-all"
                >
                  {submitting ? (tr('common.saving') || 'Saving...') : editingTeacher ? (tr('common.saveChanges') || 'Save Changes') : (tr('academic.teachers.register') || 'Register Employee')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ID Card Modal */}
      <IdCard
        open={Boolean(cardTeacher)}
        onClose={() => setCardTeacher(null)}
        kind="teacher"
        name={cardTeacher?.fullName}
        idNumber={cardTeacher?.teacherCode}
        rows={[
          { label: tr('academic.teachers.colTitle') || 'Title / Role', value: cardTeacher?.jobTitle || 'Teacher' },
          { label: tr('common.phone'), value: cardTeacher?.phone || '' },
          { label: tr('academic.teachers.colBranch') || 'Branch', value: cardTeacher?.branchId?.name || '' },
          { label: tr('academic.teachers.masuulName') || 'Guardian', value: cardTeacher?.masuulName || '' }
        ]}
      />
    </div>
  );
};

export default TeachersManagement;
