import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { RemoteSshAuthType, RemoteSshHost } from '../../../shared/types/remote-hosts'
import { Button, Dialog, Notice, Select, TextField } from '../../ui'
import styles from './RemoteHosts.module.css'

export interface RemoteHostDialogProps {
  onClose: () => void
  onSaved: (host: RemoteSshHost) => void
}

export function RemoteHostDialog({ onClose, onSaved }: RemoteHostDialogProps): ReactElement {
  const { t } = useTranslation('code')
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<RemoteSshAuthType>('agent')
  const [keyPath, setKeyPath] = useState('')
  const [secret, setSecret] = useState('')
  const [defaultRemoteDir, setDefaultRemoteDir] = useState('')
  const [probedFingerprint, setProbedFingerprint] = useState<string | null>(null)
  const [pinVerified, setPinVerified] = useState(false)
  const [probing, setProbing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const probeHostKey = async (): Promise<void> => {
    if (!window.oxe?.remoteHosts) return
    setError('')
    setProbing(true)
    try {
      const result = await window.oxe.remoteHosts.call<{ fingerprint: string }>('hosts.probeKey', {
        host: host.trim(),
        port: Number(port) || 22
      })
      if (!result.ok) {
        setError(result.error.message)
      } else {
        setProbedFingerprint(result.data.fingerprint)
        setPinVerified(true)
      }
    } finally {
      setProbing(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!window.oxe?.remoteHosts) return
    setError('')
    setSaving(true)
    try {
      const result = await window.oxe.remoteHosts.call<RemoteSshHost>('hosts.create', {
        name: name.trim(),
        host: host.trim(),
        port: Number(port) || 22,
        username: username.trim(),
        authType,
        ...(authType === 'key' && keyPath.trim() ? { keyPath: keyPath.trim() } : {}),
        ...(secret ? { secret } : {}),
        ...(pinVerified && probedFingerprint ? { pinnedFingerprint: probedFingerprint } : {}),
        ...(defaultRemoteDir.trim() ? { defaultRemoteDir: defaultRemoteDir.trim() } : {})
      })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      onSaved(result.data)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const canSave = Boolean(name.trim() && host.trim() && username.trim())

  return (
    <Dialog
      size="md"
      title={t('remoteHosts.dialog.title')}
      description={t('remoteHosts.dialog.description')}
      onClose={onClose}
      testId="remote-host-dialog"
      actions={{
        extra: (
          <Button
            size="sm"
            variant="secondary"
            disabled={!host.trim() || probing}
            loading={probing}
            onClick={() => { void probeHostKey() }}
          >
            {t('remoteHosts.dialog.probeKey')}
          </Button>
        ),
        cancel: { label: t('remoteHosts.dialog.cancel') },
        primary: {
          label: t('remoteHosts.dialog.save'),
          disabled: !canSave || saving,
          loading: saving,
          onClick: () => { void handleSave() }
        }
      }}
    >
      <div className={styles.formGrid}>
        <TextField
          label={t('remoteHosts.dialog.nameLabel')}
          placeholder={t('remoteHosts.dialog.namePlaceholder')}
          value={name}
          onChange={e => setName(e.target.value)}
        />
        <div className={styles.twoCol}>
          <TextField
            mono
            label={t('remoteHosts.dialog.hostLabel')}
            placeholder={t('remoteHosts.dialog.hostPlaceholder')}
            value={host}
            onChange={e => { setHost(e.target.value); setProbedFingerprint(null); setPinVerified(false) }}
          />
          <TextField
            mono
            label={t('remoteHosts.dialog.portLabel')}
            placeholder={t('remoteHosts.dialog.portPlaceholder')}
            value={port}
            onChange={e => setPort(e.target.value)}
          />
        </div>
        <TextField
          mono
          label={t('remoteHosts.dialog.usernameLabel')}
          placeholder={t('remoteHosts.dialog.usernamePlaceholder')}
          value={username}
          onChange={e => setUsername(e.target.value)}
        />
        <Select
          label={t('remoteHosts.dialog.authLabel')}
          value={authType}
          onChange={e => setAuthType(e.target.value as RemoteSshAuthType)}
          options={[
            { value: 'agent', label: t('remoteHosts.dialog.authAgent') },
            { value: 'key', label: t('remoteHosts.dialog.authKey') },
            { value: 'password', label: t('remoteHosts.dialog.authPassword') }
          ]}
        />
        {authType === 'key' ? (
          <TextField
            mono
            label={t('remoteHosts.dialog.keyPathLabel')}
            placeholder={t('remoteHosts.dialog.keyPathPlaceholder')}
            value={keyPath}
            onChange={e => setKeyPath(e.target.value)}
          />
        ) : null}
        {authType === 'password' || authType === 'key' ? (
          <TextField
            type="password"
            label={authType === 'password' ? t('remoteHosts.dialog.passwordLabel') : t('remoteHosts.dialog.passphraseLabel')}
            placeholder={t('remoteHosts.dialog.secretPlaceholder')}
            hint={t('remoteHosts.dialog.secretHint')}
            value={secret}
            onChange={e => setSecret(e.target.value)}
          />
        ) : null}
        <TextField
          mono
          label={t('remoteHosts.dialog.remoteDirLabel')}
          placeholder={t('remoteHosts.dialog.remoteDirPlaceholder')}
          value={defaultRemoteDir}
          onChange={e => setDefaultRemoteDir(e.target.value)}
        />
        {probedFingerprint ? (
          <div className={styles.fingerprintBox} data-testid="remote-host-fingerprint">
            <div className={styles.fingerprintHeader}>
              <span className={styles.fingerprintLabel}>{t('remoteHosts.dialog.fingerprintLabel')}</span>
            </div>
            <code className={styles.fingerprintValue}>{probedFingerprint}</code>
          </div>
        ) : null}
        {error ? <Notice intent="danger">{error}</Notice> : null}
      </div>
    </Dialog>
  )
}
