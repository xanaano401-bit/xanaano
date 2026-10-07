// Navigation, layout chrome (sidebar, navbar, footer) and the language picker.
export default {
  en: {
    dashboard: 'Dashboard', quran: "Qur'aan", quranSurahs: 'Surah Schedule', quranLessons: 'Lesson Schedule', academicManagement: 'Academic Management', classes: 'Classes', teachers: 'Teachers',
    students: 'Students', guardians: 'Guardians', exitStudents: 'Exit Students', classPromotion: 'Class Promotion',
    attendance: 'Attendance', studentAttendance: 'Student Attendance', teacherAttendance: 'Teacher Attendance',
    sessionSettings: 'Session Settings', examinations: 'Examinations', exams: 'Exams', markEntry: 'Mark Entry',
    results: 'Results', finance: 'Finance', cashbook: 'Cashbook', payers: 'Payers', monthlyPayments: 'Monthly Payments',
    wallets: 'Wallets', instituteStructure: 'Institute Structure', branches: 'Branches', reports: 'Reports',
    feePaymentReport: 'Fee Payment Report', categorySummaryReport: 'Category Summary Report', paymentReport: 'Payment Report',
    attendanceLedger: 'Attendance Ledger', usersAccess: 'Users & Access', users: 'Users', rolesPermissions: 'Roles & Permissions',
    logs: 'Logs', settings: 'Settings', search: 'Search anything...', notifications: 'Notifications', profile: 'Profile',
    changePassword: 'Change Password', logout: 'Logout', systemLanguage: 'System language', english: 'English',
    somali: 'Somali', arabic: 'Arabic', languageSaved: 'Language saved and interface updated.',
    languageDescription: 'Choose the language used in the app.', systemPreferences: 'System Preferences',
    saveLanguage: 'Save settings', instituteManagement: 'Institute Management', signedInAs: 'Signed in as',
    openMenu: 'Open menu', toggleDarkMode: 'Toggle dark mode',
    activeUpdates: '{count} active updates', openAlertsCenter: 'Open Alerts Center', user: 'User', admin: 'Admin',
    updatePassword: 'Update your account password.', currentPassword: 'Current password', newPassword: 'New password',
    confirmNewPassword: 'Confirm new password', savePassword: 'Save Password',
    sampleNotifications: {
      registration: { title: 'New Registration', detail: 'A new student has registered in the system.', time: 'Now' },
      payments: { title: 'Expenses & Payments', detail: "This month's tuition fees have been recorded.", time: '12m' },
      schedule: { title: 'Class Schedule', detail: 'The new academic timetable has been updated.', time: '1h' }
    },
    roles: {
      SUPER_ADMIN: 'Super Admin', INSTITUTE_ADMIN: 'Institute Admin', BRANCH_MANAGER: 'Branch Manager',
      TEACHER: 'Teacher', ACCOUNTANT: 'Accountant'
    }
  },
  so: {
    dashboard: 'Dulmarka Nidaamka', quran: "Qur'aan", quranSurahs: 'Jadwalka Suuradaha', quranLessons: 'Jadwalka Cashirada', academicManagement: 'Maamulka Waxbarashada', classes: 'Fasallada', teachers: 'Macallimiinta',
    students: 'Ardayda', guardians: 'Masuuliyiinta', exitStudents: 'Ardayda Baxay', classPromotion: 'Dallacsiinta Fasalka',
    attendance: 'Xaadirinta', studentAttendance: 'Xaadirinta Ardayda', teacherAttendance: 'Xaadirinta Macallimiinta',
    sessionSettings: 'Dejinta Fadhiyada', examinations: 'Imtixaannada', exams: 'Imtixaannada', markEntry: 'Gelinta Dhibcaha',
    results: 'Natiijooyinka', finance: 'Maaliyadda', cashbook: 'Buugga Lacagta', payers: 'Bixiyeyaasha', monthlyPayments: 'Lacag-bixinta Bishii',
    wallets: 'Kaydadka Lacagta', instituteStructure: 'Qaab-dhismeedka Machadka', branches: 'Laamaha', reports: 'Warbixinnada',
    feePaymentReport: 'Warbixinta Lacag-bixinta Khidmadda', categorySummaryReport: 'Warbixinta Soo-koobidda Qaybaha', paymentReport: 'Warbixinta Lacag-bixinta',
    attendanceLedger: 'Diiwaanka Xaadirinta', usersAccess: 'Isticmaalayaasha & Galitaanka', users: 'Isticmaalayaasha', rolesPermissions: 'Doorarka & Ogolaanshaha',
    logs: 'Diiwaannada Dhaqdhaqaaqa', settings: 'Dejinta', search: 'Raadi wax kasta...', notifications: 'Ogeysiisyada', profile: 'Astaanta',
    changePassword: 'Beddel Furaha Sirta', logout: 'Ka bax', systemLanguage: 'Luqadda nidaamka', english: 'Ingiriisi',
    somali: 'Soomaali', arabic: 'Carabi', languageSaved: 'Luqadda waa la kaydiyey, muuqaalkana waa la cusbooneysiiyey.',
    languageDescription: 'Dooro luqadda barnaamijka.', systemPreferences: 'Doorbidyada Nidaamka',
    saveLanguage: 'Kaydi dejimaha', instituteManagement: 'Maamulka Machadka', signedInAs: 'Waxaad ku gashay',
    openMenu: 'Fur liiska', toggleDarkMode: 'Beddel habka mugdiga',
    activeUpdates: '{count} war-cusub oo firfircoon', openAlertsCenter: 'Fur Xarunta Digniinaha', user: 'Isticmaale', admin: 'Maamule',
    updatePassword: 'Cusboonaysii furaha sirta ah ee akoonkaaga.', currentPassword: 'Furaha sirta ah ee hadda', newPassword: 'Furaha sirta ah ee cusub',
    confirmNewPassword: 'Xaqiiji furaha sirta ah ee cusub', savePassword: 'Kaydi Furaha Sirta',
    sampleNotifications: {
      registration: { title: 'Diiwaangelin Cusub', detail: 'Arday cusub ayaa is-diiwaangeliyay nidaamka.', time: 'Hadda' },
      payments: { title: 'Kharash & Lacag-bixin', detail: 'Khidmadda waxbarashada bishan ayaa la diiwaangeliyay.', time: '12d' },
      schedule: { title: 'Jadwalka Fasallada', detail: 'Jadwalka cusub ee waxbarashada waa la cusbooneysiiyay.', time: '1s' }
    },
    roles: {
      SUPER_ADMIN: 'Maamulaha Sare', INSTITUTE_ADMIN: 'Maamulaha Machadka', BRANCH_MANAGER: 'Maareeyaha Laanta',
      TEACHER: 'Macallin', ACCOUNTANT: 'Xisaabiye'
    }
  },
  ar: {
    dashboard: 'لوحة التحكم', quran: 'القرآن الكريم', quranSurahs: 'جدول السور', quranLessons: 'جدول الدروس', academicManagement: 'الإدارة الأكاديمية', classes: 'الفصول', teachers: 'المعلمون', students: 'الطلاب', classPromotion: 'ترقية الفصل', attendance: 'الحضور', studentAttendance: 'حضور الطلاب', teacherAttendance: 'حضور المعلمين', examinations: 'الامتحانات', exams: 'الاختبارات', markEntry: 'إدخال الدرجات', results: 'النتائج', finance: 'المالية', cashbook: 'دفتر النقدية', payers: 'الدافعون', wallets: 'المحافظ', instituteStructure: 'هيكل المعهد', branches: 'الفروع', reports: 'التقارير', feePaymentReport: 'تقرير دفع الرسوم', categorySummaryReport: 'تقرير ملخص الفئات', paymentReport: 'تقرير الدفع', attendanceLedger: 'سجل الحضور', usersAccess: 'المستخدمون والصلاحيات', users: 'المستخدمون', rolesPermissions: 'الأدوار والصلاحيات', logs: 'السجلات', settings: 'الإعدادات', search: 'ابحث عن أي شيء...', notifications: 'الإشعارات', profile: 'الملف الشخصي', changePassword: 'تغيير كلمة المرور', logout: 'تسجيل الخروج', systemLanguage: 'لغة النظام', english: 'الإنجليزية', somali: 'الصومالية', arabic: 'العربية', languageSaved: 'تم حفظ اللغة وتحديث الواجهة.', languageDescription: 'اختر اللغة المستخدمة في التطبيق.', systemPreferences: 'تفضيلات النظام', saveLanguage: 'حفظ الإعدادات', instituteManagement: 'إدارة المعهد', signedInAs: 'تم تسجيل الدخول باسم', openMenu: 'فتح القائمة', toggleDarkMode: 'تبديل الوضع الداكن'
  }
};
