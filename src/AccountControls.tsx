import React, { useContext } from 'react';
import { AccessAccountContext } from './AccessAccountContext';
import './AccountControls.css';

export function AccountControls() {
  const account = useContext(AccessAccountContext);
  if (!account) return null;

  return (
    <div className="toolbar-account" role="group" aria-label="アカウント">
      <span className="toolbar-account__name" title={account.email}>{account.name}</span>
      <button className="toolbar-account__logout" type="button" onClick={account.logout}>ログアウト</button>
    </div>
  );
}
