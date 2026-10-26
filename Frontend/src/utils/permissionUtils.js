export const PERMISSION_ACTIONS = ['Read', 'Add', 'Edit', 'Delete', 'Export'];

const ACTION_ALIASES = {
  view: 'Read',
  read: 'Read',
  list: 'Read',
  create: 'Add',
  add: 'Add',
  write: 'Add',
  edit: 'Edit',
  update: 'Edit',
  delete: 'Delete',
  remove: 'Delete',
  export: 'Export'
};

export const normalizeAction = (action) => ACTION_ALIASES[String(action || '').trim().toLowerCase()] || null;

const permissionObjectHasAction = (permissions, action) => {
  const normalizedAction = normalizeAction(action);
  if (!permissions || !normalizedAction || typeof permissions !== 'object') return false;

  return Object.entries(permissions).some(([storedAction, value]) =>
    value === true && normalizeAction(storedAction) === normalizedAction
  );
};

export const normalizePermissions = (permissions, template = null) => {
  const normalized = template ? JSON.parse(JSON.stringify(template)) : {};
  if (!permissions || typeof permissions !== 'object') return normalized;

  if (permissions['*'] === true) {
    Object.keys(normalized).forEach(moduleName => {
      Object.keys(normalized[moduleName]).forEach(subName => {
        Object.keys(normalized[moduleName][subName]).forEach(action => {
          normalized[moduleName][subName][action] = true;
        });
      });
    });
    return normalized;
  }

  Object.entries(permissions).forEach(([moduleName, modulePerms]) => {
    if (!modulePerms || typeof modulePerms !== 'object') return;
    if (!normalized[moduleName]) normalized[moduleName] = {};

    Object.entries(modulePerms).forEach(([subName, subPerms]) => {
      if (!subPerms || typeof subPerms !== 'object') return;
      if (!normalized[moduleName][subName]) {
        normalized[moduleName][subName] = PERMISSION_ACTIONS.reduce((acc, action) => {
          acc[action] = false;
          return acc;
        }, {});
      }

      Object.entries(subPerms).forEach(([actionName, value]) => {
        const normalizedAction = normalizeAction(actionName);
        if (normalizedAction && normalized[moduleName][subName].hasOwnProperty(normalizedAction)) {
          normalized[moduleName][subName][normalizedAction] = normalized[moduleName][subName][normalizedAction] || value === true;
        }
      });
    });
  });

  return normalized;
};

export const roleHasPermission = (role, moduleName, action = 'Read', subModuleName = null) => {
  if (!role?.permissions) return false;
  if (role.permissions['*'] === true) return true;

  const normalizedAction = normalizeAction(action);
  if (!normalizedAction) return false;

  const modulePerms = role.permissions[moduleName];
  if (!modulePerms || typeof modulePerms !== 'object') return false;

  if (subModuleName) {
    return permissionObjectHasAction(modulePerms[subModuleName], normalizedAction);
  }

  return Object.values(modulePerms).some(subPerms =>
    permissionObjectHasAction(subPerms, normalizedAction)
  );
};

export const userHasPermission = (user, moduleName, action = 'Read', subModuleName = null) => {
  if (!user) return false;

  // 1. Direct customPermissions attached to the user account
  if (user.customPermissions && typeof user.customPermissions === 'object' && Object.keys(user.customPermissions).length > 0) {
    if (roleHasPermission({ permissions: user.customPermissions }, moduleName, action, subModuleName)) {
      return true;
    }
  }

  // 2. Roles assigned to the user
  if (user.roles && Array.isArray(user.roles) && user.roles.length > 0) {
    return user.roles.some(role => roleHasPermission(role, moduleName, action, subModuleName));
  }

  return false;
};

export const hasNavPermission = (user, currentRole, moduleLabel, subModuleLabel = null, navConfig = null) => {
  if (!user) return false;

  const roleNormalized = typeof currentRole === 'string' ? currentRole.toLowerCase() : '';
  const isSuperOrAdmin = roleNormalized.includes('super') ||
                         roleNormalized.includes('owner') ||
                         roleNormalized.includes('system') ||
                         roleNormalized === 'institute admin' ||
                         roleNormalized === 'institute_admin';

  if (isSuperOrAdmin) return true;

  // If the user has specific assigned roles (e.g. IMTIXAAN) or customPermissions,
  // custom permissions strictly govern their access!
  const hasCustomRoles = (user.roles && Array.isArray(user.roles) && user.roles.length > 0) ||
                         (user.customPermissions && Object.keys(user.customPermissions).length > 0);

  if (hasCustomRoles) {
    return userHasPermission(user, moduleLabel, 'Read', subModuleLabel);
  }

  // Fallback to built-in role defaults in navConfig
  if (Array.isArray(navConfig)) {
    const navItem = navConfig.find(item => item.label === moduleLabel);
    if (navItem && Array.isArray(navItem.roles)) {
      const roleUpper = currentRole ? currentRole.toUpperCase().replace(/\s+/g, '_') : '';
      const match = navItem.roles.some(r => {
        const rUpper = String(r).toUpperCase().replace(/\s+/g, '_');
        return rUpper === roleUpper || rUpper === roleNormalized.toUpperCase();
      });
      if (match) return true;
    }
  }

  return false;
};

export const getDefaultLandingPath = (user, currentRole, navConfig = []) => {
  if (!user) return '/';

  // If user is permitted on Dashboard, land on '/'
  if (hasNavPermission(user, currentRole, 'Dashboard', null, navConfig)) {
    return '/';
  }

  // Otherwise find the first allowed module and its first allowed sub-route
  if (Array.isArray(navConfig)) {
    for (const item of navConfig) {
      if (item.label === 'Dashboard') continue;

      if (item.subItems && item.subItems.length > 0) {
        for (const sub of item.subItems) {
          if (hasNavPermission(user, currentRole, item.label, sub.label, navConfig)) {
            return sub.path;
          }
        }
      } else {
        if (hasNavPermission(user, currentRole, item.label, null, navConfig)) {
          return item.path;
        }
      }
    }
  }

  return '/';
};
