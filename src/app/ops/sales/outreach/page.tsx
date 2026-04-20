'use client';

import React, { useState, useEffect, useCallback } from 'react';

interface Sequence {
  id: string;
  name: string;
  type: 'COLD_INTRO' | 'WARM_FOLLOW_UP' | 'QUOTE_CHASE' | 'WIN_BACK' | 'NEW_BUILDER_WELCOME';
  mode: 'AUTO' | 'SEMI_AUTO';
  steps: Step[];
  enrollees: number;
  status: 'ACTIVE' | 'PAUSED';
}

interface Step {
  id: string;
  delay_days: number;
  channel: 'EMAIL' | 'CALL_TASK' | 'SMS';
  subject: string;
  body: string;
}

interface QueueItem {
  id: string;
  prospect_email: string;
  prospect_name: string;
  sequence_id: string;
  sequence_name: string;
  scheduled_at: string;
  status: 'PENDING' | 'SENT' | 'OPENED' | 'REPLIED';
  draft_subject?: string;
  draft_body?: string;
  channel: 'EMAIL' | 'CALL_TASK' | 'SMS';
}

interface Template {
  id: string;
  name: string;
  type: string;
  subject: string;
  body: string;
}

interface PerformanceMetric {
  sequence_id: string;
  sequence_name: string;
  sent_count: number;
  open_rate: number;
  reply_rate: number;
  conversion_rate: number;
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

const NAVY = '#3E2A1E';
const ORANGE = '#C9822B';

export default function OutreachPage() {
  const [activeTab, setActiveTab] = useState<'sequences' | 'queue' | 'templates' | 'performance'>('sequences');
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [performance, setPerformance] = useState<PerformanceMetric[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<Sequence | null>(null);
  const [showCreateSequenceModal, setShowCreateSequenceModal] = useState(false);
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [showTemplateDetail, setShowTemplateDetail] = useState<Template | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  const fetchSequences = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/sales/outreach-engine?report=sequences');
      if (!res.ok) throw new Error('Failed to fetch sequences');
      const data = await res.json();
      setSequences(data.sequences || []);
    } catch (error) {
      addToast('Failed to fetch sequences', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/sales/outreach-engine?report=queue');
      if (!res.ok) throw new Error('Failed to fetch queue');
      const data = await res.json();
      setQueueItems(data.queue || []);
    } catch (error) {
      addToast('Failed to fetch queue', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/sales/outreach-engine?report=templates');
      if (!res.ok) throw new Error('Failed to fetch templates');
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch (error) {
      addToast('Failed to fetch templates', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const fetchPerformance = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/ops/sales/outreach-engine?report=performance');
      if (!res.ok) throw new Error('Failed to fetch performance');
      const data = await res.json();
      setPerformance(data.performance || []);
    } catch (error) {
      addToast('Failed to fetch performance', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (activeTab === 'sequences') fetchSequences();
    else if (activeTab === 'queue') fetchQueue();
    else if (activeTab === 'templates') fetchTemplates();
    else if (activeTab === 'performance') fetchPerformance();
  }, [activeTab, fetchSequences, fetchQueue, fetchTemplates, fetchPerformance]);

  const handleCreateSequence = async (sequenceData: Omit<Sequence, 'id' | 'enrollees' | 'status'>) => {
    try {
      const res = await fetch('/api/ops/sales/outreach-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_sequence', ...sequenceData }),
      });
      if (!res.ok) throw new Error('Failed to create sequence');
      await fetchSequences();
      setShowCreateSequenceModal(false);
      addToast('Sequence created successfully', 'success');
    } catch (error) {
      addToast('Failed to create sequence', 'error');
    }
  };

  const handleEnrollProspect = async (enrollData: { sequence_id: string; prospect_email: string; prospect_name: string; company_name: string }) => {
    try {
      const res = await fetch('/api/ops/sales/outreach-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enroll_prospect', ...enrollData }),
      });
      if (!res.ok) throw new Error('Failed to enroll prospect');
      await fetchSequences();
      setShowEnrollModal(false);
      addToast('Prospect enrolled successfully', 'success');
    } catch (error) {
      addToast('Failed to enroll prospect', 'error');
    }
  };

  const handleApproveEmail = async (queueItemId: string) => {
    try {
      const res = await fetch('/api/ops/sales/outreach-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_email', queue_id: queueItemId }),
      });
      if (!res.ok) throw new Error('Failed to approve email');
      await fetchQueue();
      addToast('Email sent successfully', 'success');
    } catch (error) {
      addToast('Failed to send email', 'error');
    }
  };

  const handleEditEmail = async (queueItemId: string, subject: string, body: string) => {
    try {
      const res = await fetch('/api/ops/sales/outreach-engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit_email', queue_id: queueItemId, subject, body }),
      });
      if (!res.ok) throw new Error('Failed to edit email');
      await fetchQueue();
      addToast('Email updated successfully', 'success');
    } catch (error) {
      addToast('Failed to update email', 'error');
    }
  };

  return (
    <div style={{ backgroundColor: '#FAFAFA', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '24px', backgroundColor: 'white', borderBottom: '1px solid #E5E7EB' }}>
        <h1 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: 'bold', color: NAVY }}>Outreach Sequences</h1>
        <p style={{ margin: '0', color: '#6B7280', fontSize: '14px' }}>Manage sales outreach campaigns and templates</p>
      </div>

      {/* Tab Navigation */}
      <div style={{ borderBottom: '1px solid #E5E7EB', backgroundColor: 'white', display: 'flex', gap: '24px', padding: '0 24px' }}>
        {(['sequences', 'queue', 'templates', 'performance'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: '16px 0',
              border: 'none',
              background: 'none',
              fontSize: '14px',
              fontWeight: activeTab === tab ? '600' : '400',
              color: activeTab === tab ? NAVY : '#6B7280',
              borderBottom: activeTab === tab ? `3px solid ${ORANGE}` : 'none',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Toast Notifications */}
      <div style={{ position: 'fixed', top: '24px', right: '24px', zIndex: 1000 }}>
        {toasts.map((toast) => (
          <div
            key={toast.id}
            style={{
              padding: '12px 16px',
              borderRadius: '6px',
              marginBottom: '8px',
              color: 'white',
              fontSize: '14px',
              backgroundColor:
                toast.type === 'success' ? '#10B981' : toast.type === 'error' ? '#EF4444' : '#3B82F6',
            }}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {/* Content Area */}
      <div style={{ padding: '24px' }}>
        {activeTab === 'sequences' && (
          <SequencesTab
            sequences={sequences}
            selectedSequence={selectedSequence}
            setSelectedSequence={setSelectedSequence}
            loading={loading}
            onCreateSequence={() => setShowCreateSequenceModal(true)}
            onEnrollProspect={() => setShowEnrollModal(true)}
            onRefresh={fetchSequences}
          />
        )}

        {activeTab === 'queue' && (
          <QueueTab
            queueItems={queueItems}
            loading={loading}
            onApproveEmail={handleApproveEmail}
            onEditEmail={handleEditEmail}
            onRefresh={fetchQueue}
          />
        )}

        {activeTab === 'templates' && (
          <TemplatesTab
            templates={templates}
            selectedTemplate={showTemplateDetail}
            onSelectTemplate={setShowTemplateDetail}
            loading={loading}
            onRefresh={fetchTemplates}
          />
        )}

        {activeTab === 'performance' && (
          <PerformanceTab
            performance={performance}
            loading={loading}
            onRefresh={fetchPerformance}
          />
        )}
      </div>

      {/* Modals */}
      {showCreateSequenceModal && (
        <CreateSequenceModal
          onClose={() => setShowCreateSequenceModal(false)}
          onCreate={handleCreateSequence}
        />
      )}

      {showEnrollModal && (
        <EnrollProspectModal
          sequences={sequences}
          onClose={() => setShowEnrollModal(false)}
          onEnroll={handleEnrollProspect}
        />
      )}

      {showTemplateDetail && (
        <TemplateDetailModal
          template={showTemplateDetail}
          onClose={() => setShowTemplateDetail(null)}
        />
      )}
    </div>
  );
}

// ==================== Tab Components ====================

function SequencesTab({
  sequences,
  selectedSequence,
  setSelectedSequence,
  loading,
  onCreateSequence,
  onEnrollProspect,
  onRefresh,
}: {
  sequences: Sequence[];
  selectedSequence: Sequence | null;
  setSelectedSequence: (seq: Sequence | null) => void;
  loading: boolean;
  onCreateSequence: () => void;
  onEnrollProspect: () => void;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={onCreateSequence}
            style={{
              padding: '8px 16px',
              backgroundColor: ORANGE,
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            + Create Sequence
          </button>
          <button
            onClick={onEnrollProspect}
            style={{
              padding: '8px 16px',
              backgroundColor: NAVY,
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            + Enroll Prospect
          </button>
        </div>
        <button
          onClick={onRefresh}
          style={{
            padding: '8px 16px',
            backgroundColor: 'white',
            color: NAVY,
            border: `1px solid #E5E7EB`,
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>Loading sequences...</div>}

      {!loading && sequences.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #E5E7EB',
            color: '#6B7280',
          }}
        >
          No sequences yet. Create one to get started.
        </div>
      )}

      {!loading && sequences.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
          {sequences.map((seq) => (
            <div
              key={seq.id}
              onClick={() => setSelectedSequence(selectedSequence?.id === seq.id ? null : seq)}
              style={{
                backgroundColor: 'white',
                border: `1px solid #E5E7EB`,
                borderRadius: '12px',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s',
                boxShadow: selectedSequence?.id === seq.id ? '0 4px 12px rgba(0,0,0,0.1)' : 'none',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = selectedSequence?.id === seq.id ? '0 4px 12px rgba(0,0,0,0.1)' : 'none';
              }}
            >
              <h3 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: NAVY }}>{seq.name}</h3>

              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <span
                  style={{
                    padding: '4px 8px',
                    backgroundColor: ORANGE,
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '600',
                  }}
                >
                  {seq.type}
                </span>
                <span
                  style={{
                    padding: '4px 8px',
                    backgroundColor: seq.mode === 'AUTO' ? '#10B981' : '#3B82F6',
                    color: 'white',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '600',
                  }}
                >
                  {seq.mode}
                </span>
                <span
                  style={{
                    padding: '4px 8px',
                    backgroundColor: seq.status === 'ACTIVE' ? '#D1FAE5' : '#FEE2E2',
                    color: seq.status === 'ACTIVE' ? '#065F46' : '#991B1B',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: '600',
                  }}
                >
                  {seq.status}
                </span>
              </div>

              <div style={{ fontSize: '13px', color: '#6B7280', lineHeight: '1.6' }}>
                <div>Steps: {seq.steps.length}</div>
                <div>Enrollees: {seq.enrollees}</div>
              </div>

              {selectedSequence?.id === seq.id && (
                <div
                  style={{
                    marginTop: '16px',
                    paddingTop: '16px',
                    borderTop: '1px solid #E5E7EB',
                  }}
                >
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '13px', fontWeight: '600', color: NAVY }}>Steps</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {seq.steps.map((step, idx) => (
                      <div
                        key={step.id}
                        style={{
                          padding: '8px',
                          backgroundColor: '#F9FAFB',
                          borderRadius: '6px',
                          fontSize: '12px',
                          border: '1px solid #E5E7EB',
                        }}
                      >
                        <div style={{ fontWeight: '600', color: NAVY }}>
                          Step {idx + 1}: {step.channel} (Day {step.delay_days})
                        </div>
                        <div style={{ marginTop: '4px', color: '#374151' }}>
                          {step.subject && <div>Subject: {step.subject}</div>}
                          {step.body && <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Body: {step.body.substring(0, 50)}...</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function QueueTab({
  queueItems,
  loading,
  onApproveEmail,
  onEditEmail,
  onRefresh,
}: {
  queueItems: QueueItem[];
  loading: boolean;
  onApproveEmail: (id: string) => void;
  onEditEmail: (id: string, subject: string, body: string) => void;
  onRefresh: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editBody, setEditBody] = useState('');

  const getUrgencyColor = (scheduledAt: string) => {
    const now = new Date();
    const scheduled = new Date(scheduledAt);
    const diffHours = (scheduled.getTime() - now.getTime()) / (1000 * 60 * 60);

    if (diffHours < 0) return '#EF4444'; // Red - overdue
    if (diffHours <= 24) return ORANGE; // Orange - today
    return '#9CA3AF'; // Gray - upcoming
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
        <button
          onClick={onRefresh}
          style={{
            padding: '8px 16px',
            backgroundColor: 'white',
            color: NAVY,
            border: `1px solid #E5E7EB`,
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>Loading queue...</div>}

      {!loading && queueItems.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #E5E7EB',
            color: '#6B7280',
          }}
        >
          Queue is empty.
        </div>
      )}

      {!loading && queueItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {queueItems.map((item) => (
            <div
              key={item.id}
              style={{
                backgroundColor: 'white',
                border: `1px solid #E5E7EB`,
                borderLeft: `4px solid ${getUrgencyColor(item.scheduled_at)}`,
                borderRadius: '12px',
                padding: '16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: '15px', fontWeight: '600', color: NAVY }}>
                    {item.prospect_name} ({item.prospect_email})
                  </h3>
                  <p style={{ margin: '0', fontSize: '13px', color: '#6B7280' }}>
                    Sequence: {item.sequence_name}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      padding: '4px 8px',
                      backgroundColor: item.status === 'PENDING' ? ORANGE : '#10B981',
                      color: 'white',
                      borderRadius: '4px',
                      fontSize: '12px',
                      fontWeight: '600',
                    }}
                  >
                    {item.status}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: '12px', color: '#6B7280', marginBottom: '12px' }}>
                Scheduled: {new Date(item.scheduled_at).toLocaleString()}
              </div>

              {item.status === 'PENDING' && (
                <div style={{ backgroundColor: '#F9FAFB', padding: '12px', borderRadius: '8px', marginBottom: '12px' }}>
                  {editingId === item.id ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <input
                        type="text"
                        value={editSubject}
                        onChange={(e) => setEditSubject(e.target.value)}
                        placeholder="Subject"
                        style={{
                          padding: '8px 12px',
                          border: `1px solid #E5E7EB`,
                          borderRadius: '6px',
                          fontSize: '13px',
                        }}
                      />
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        placeholder="Body"
                        style={{
                          padding: '8px 12px',
                          border: `1px solid #E5E7EB`,
                          borderRadius: '6px',
                          fontSize: '13px',
                          minHeight: '100px',
                          fontFamily: 'inherit',
                        }}
                      />
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => {
                            onEditEmail(item.id, editSubject, editBody);
                            setEditingId(null);
                          }}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: NAVY,
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#E5E7EB',
                            color: '#374151',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: '8px' }}>
                        <strong>Subject:</strong> {item.draft_subject}
                      </div>
                      <div style={{ marginBottom: '12px', lineHeight: '1.5' }}>
                        <strong>Body:</strong>
                        <div style={{ whiteSpace: 'pre-wrap', marginTop: '4px', fontSize: '12px' }}>{item.draft_body}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button
                          onClick={() => {
                            setEditingId(item.id);
                            setEditSubject(item.draft_subject || '');
                            setEditBody(item.draft_body || '');
                          }}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#F3F4F6',
                            color: NAVY,
                            border: `1px solid #D1D5DB`,
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontWeight: '600',
                          }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => onApproveEmail(item.id)}
                          style={{
                            padding: '6px 12px',
                            backgroundColor: '#10B981',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontWeight: '600',
                          }}
                        >
                          Approve & Send
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {item.status !== 'PENDING' && (
                <div
                  style={{
                    backgroundColor: '#F0FDFA',
                    padding: '12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#065F46',
                  }}
                >
                  Sent via {item.channel}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TemplatesTab({
  templates,
  selectedTemplate,
  onSelectTemplate,
  loading,
  onRefresh,
}: {
  templates: Template[];
  selectedTemplate: Template | null;
  onSelectTemplate: (template: Template | null) => void;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
        <button
          onClick={onRefresh}
          style={{
            padding: '8px 16px',
            backgroundColor: 'white',
            color: NAVY,
            border: `1px solid #E5E7EB`,
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>Loading templates...</div>}

      {!loading && templates.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #E5E7EB',
            color: '#6B7280',
          }}
        >
          No templates yet.
        </div>
      )}

      {!loading && templates.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
          {templates.map((template) => (
            <div
              key={template.id}
              onClick={() => onSelectTemplate(template)}
              style={{
                backgroundColor: 'white',
                border: `1px solid #E5E7EB`,
                borderRadius: '12px',
                padding: '16px',
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: '600', color: NAVY }}>{template.name}</h3>

              <span
                style={{
                  display: 'inline-block',
                  padding: '4px 8px',
                  backgroundColor: ORANGE,
                  color: 'white',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: '600',
                  marginBottom: '12px',
                }}
              >
                {template.type}
              </span>

              <div style={{ marginBottom: '12px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280' }}>Subject</div>
                <div
                  style={{
                    fontSize: '13px',
                    color: '#374151',
                    marginTop: '4px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {template.subject}
                </div>
              </div>

              <div>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280' }}>Preview</div>
                <div
                  style={{
                    fontSize: '12px',
                    color: '#6B7280',
                    marginTop: '4px',
                    maxHeight: '60px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {template.body.substring(0, 150)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PerformanceTab({
  performance,
  loading,
  onRefresh,
}: {
  performance: PerformanceMetric[];
  loading: boolean;
  onRefresh: () => void;
}) {
  const totalSent = performance.reduce((sum, p) => sum + p.sent_count, 0);
  const avgOpenRate = performance.length > 0 ? performance.reduce((sum, p) => sum + p.open_rate, 0) / performance.length : 0;
  const avgReplyRate = performance.length > 0 ? performance.reduce((sum, p) => sum + p.reply_rate, 0) / performance.length : 0;
  const bestPerforming = performance.length > 0 ? performance.reduce((best, p) => (p.conversion_rate > best.conversion_rate ? p : best)) : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
        <button
          onClick={onRefresh}
          style={{
            padding: '8px 16px',
            backgroundColor: 'white',
            color: NAVY,
            border: `1px solid #E5E7EB`,
            borderRadius: '6px',
            fontSize: '14px',
            fontWeight: '600',
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '40px', color: '#6B7280' }}>Loading performance...</div>}

      {!loading && performance.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #E5E7EB',
            color: '#6B7280',
          }}
        >
          No performance data yet.
        </div>
      )}

      {!loading && performance.length > 0 && (
        <div>
          {/* Overall Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginBottom: '24px' }}>
            <div style={{ backgroundColor: 'white', border: `1px solid #E5E7EB`, borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '8px' }}>Total Sent</div>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: NAVY }}>{totalSent}</div>
            </div>
            <div style={{ backgroundColor: 'white', border: `1px solid #E5E7EB`, borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '8px' }}>Avg Open Rate</div>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: NAVY }}>{(avgOpenRate * 100).toFixed(1)}%</div>
            </div>
            <div style={{ backgroundColor: 'white', border: `1px solid #E5E7EB`, borderRadius: '12px', padding: '16px' }}>
              <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '8px' }}>Avg Reply Rate</div>
              <div style={{ fontSize: '32px', fontWeight: 'bold', color: NAVY }}>{(avgReplyRate * 100).toFixed(1)}%</div>
            </div>
            {bestPerforming && (
              <div style={{ backgroundColor: 'white', border: `1px solid #E5E7EB`, borderRadius: '12px', padding: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '8px' }}>Best Performing</div>
                <div style={{ fontSize: '14px', fontWeight: '600', color: NAVY }}>{bestPerforming.sequence_name}</div>
              </div>
            )}
          </div>

          {/* Per-Sequence Metrics */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {performance.map((metric) => (
              <div
                key={metric.sequence_id}
                style={{
                  backgroundColor: 'white',
                  border: `1px solid #E5E7EB`,
                  borderRadius: '12px',
                  padding: '16px',
                }}
              >
                <div style={{ marginBottom: '12px' }}>
                  <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', fontWeight: '600', color: NAVY }}>
                    {metric.sequence_name}
                  </h3>
                  <div style={{ fontSize: '12px', color: '#6B7280' }}>Sent: {metric.sent_count}</div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px' }}>
                  <BarChart label="Open Rate" value={metric.open_rate} />
                  <BarChart label="Reply Rate" value={metric.reply_rate} />
                  <BarChart label="Conversion Rate" value={metric.conversion_rate} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BarChart({ label, value }: { label: string; value: number }) {
  const percentage = Math.min(100, Math.max(0, value * 100));

  return (
    <div>
      <div style={{ fontSize: '12px', fontWeight: '600', color: '#6B7280', marginBottom: '4px' }}>{label}</div>
      <div
        style={{
          height: '20px',
          backgroundColor: '#F3F4F6',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${percentage}%`,
            backgroundColor: ORANGE,
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      <div style={{ fontSize: '11px', color: '#6B7280', marginTop: '2px' }}>{percentage.toFixed(1)}%</div>
    </div>
  );
}

// ==================== Modal Components ====================

function CreateSequenceModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: Omit<Sequence, 'id' | 'enrollees' | 'status'>) => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Sequence['type']>('COLD_INTRO');
  const [mode, setMode] = useState<'AUTO' | 'SEMI_AUTO'>('AUTO');
  const [steps, setSteps] = useState<Omit<Step, 'id'>[]>([]);
  const [currentStep, setCurrentStep] = useState<Omit<Step, 'id'> | null>(null);

  const handleAddStep = () => {
    if (currentStep && currentStep.subject && currentStep.body) {
      setSteps([...steps, currentStep]);
      setCurrentStep(null);
    }
  };

  const handleRemoveStep = (idx: number) => {
    setSteps(steps.filter((_, i) => i !== idx));
  };

  const handleSubmit = () => {
    if (name && steps.length > 0) {
      onCreate({
        name,
        type,
        mode,
        steps: steps.map((s) => ({ ...s, id: Math.random().toString(36).substr(2, 9) })),
      });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflowY: 'auto',
          width: '90%',
        }}
      >
        <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '700', color: NAVY }}>Create Sequence</h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Sequence Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Q2 Cold Outreach"
            style={{
              width: '100%',
              padding: '8px 12px',
              border: `1px solid #E5E7EB`,
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Sequence['type'])}
              style={{
                width: '100%',
                padding: '8px 12px',
                border: `1px solid #E5E7EB`,
                borderRadius: '6px',
                fontSize: '14px',
              }}
            >
              <option value="COLD_INTRO">Cold Intro</option>
              <option value="WARM_FOLLOW_UP">Warm Follow-up</option>
              <option value="QUOTE_CHASE">Quote Chase</option>
              <option value="WIN_BACK">Win Back</option>
              <option value="NEW_BUILDER_WELCOME">New Builder Welcome</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
              Mode
            </label>
            <div style={{ display: 'flex', alignItems: 'center', height: '36px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="radio"
                  checked={mode === 'AUTO'}
                  onChange={() => setMode('AUTO')}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: '14px', color: '#374151' }}>Auto</span>
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', marginLeft: '16px' }}>
                <input
                  type="radio"
                  checked={mode === 'SEMI_AUTO'}
                  onChange={() => setMode('SEMI_AUTO')}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{ fontSize: '14px', color: '#374151' }}>Semi-Auto</span>
              </label>
            </div>
          </div>
        </div>

        <div style={{ marginBottom: '16px', padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '8px', border: `1px solid #E5E7EB` }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: '600', color: NAVY }}>Steps</h3>

          {steps.length > 0 && (
            <div style={{ marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {steps.map((step, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '8px',
                    backgroundColor: 'white',
                    borderRadius: '4px',
                    border: `1px solid #E5E7EB`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '12px', color: '#374151' }}>
                    Step {idx + 1}: {step.channel} (Day {step.delay_days})
                  </span>
                  <button
                    onClick={() => handleRemoveStep(idx)}
                    style={{
                      padding: '4px 8px',
                      backgroundColor: '#FEE2E2',
                      color: '#991B1B',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '12px',
                      cursor: 'pointer',
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ padding: '12px', backgroundColor: 'white', borderRadius: '6px', border: `1px solid #E5E7EB` }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', fontWeight: '600', color: NAVY }}>New Step</h4>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              <input
                type="number"
                min="0"
                value={currentStep?.delay_days || ''}
                onChange={(e) => setCurrentStep({ ...currentStep, delay_days: parseInt(e.target.value) || 0 } as Omit<Step, 'id'>)}
                placeholder="Days"
                style={{
                  padding: '6px 8px',
                  border: `1px solid #E5E7EB`,
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              />
              <select
                value={currentStep?.channel || 'EMAIL'}
                onChange={(e) => setCurrentStep({ ...currentStep, channel: e.target.value as Step['channel'] } as Omit<Step, 'id'>)}
                style={{
                  padding: '6px 8px',
                  border: `1px solid #E5E7EB`,
                  borderRadius: '4px',
                  fontSize: '12px',
                }}
              >
                <option value="EMAIL">Email</option>
                <option value="CALL_TASK">Call Task</option>
                <option value="SMS">SMS</option>
              </select>
            </div>

            <input
              type="text"
              value={currentStep?.subject || ''}
              onChange={(e) => setCurrentStep({ ...currentStep, subject: e.target.value } as Omit<Step, 'id'>)}
              placeholder="Subject"
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid #E5E7EB`,
                borderRadius: '4px',
                fontSize: '12px',
                marginBottom: '8px',
                boxSizing: 'border-box',
              }}
            />

            <textarea
              value={currentStep?.body || ''}
              onChange={(e) => setCurrentStep({ ...currentStep, body: e.target.value } as Omit<Step, 'id'>)}
              placeholder="Body template"
              style={{
                width: '100%',
                padding: '6px 8px',
                border: `1px solid #E5E7EB`,
                borderRadius: '4px',
                fontSize: '12px',
                minHeight: '80px',
                fontFamily: 'inherit',
                marginBottom: '8px',
                boxSizing: 'border-box',
              }}
            />

            <button
              onClick={handleAddStep}
              style={{
                padding: '6px 12px',
                backgroundColor: ORANGE,
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Add Step
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: '#E5E7EB',
              color: '#374151',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name || steps.length === 0}
            style={{
              padding: '8px 16px',
              backgroundColor: !name || steps.length === 0 ? '#D1D5DB' : NAVY,
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: !name || steps.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            Create Sequence
          </button>
        </div>
      </div>
    </div>
  );
}

function EnrollProspectModal({
  sequences,
  onClose,
  onEnroll,
}: {
  sequences: Sequence[];
  onClose: () => void;
  onEnroll: (data: { sequence_id: string; prospect_email: string; prospect_name: string; company_name: string }) => void;
}) {
  const [sequenceId, setSequenceId] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');

  const handleSubmit = () => {
    if (sequenceId && email && name && company) {
      onEnroll({
        sequence_id: sequenceId,
        prospect_email: email,
        prospect_name: name,
        company_name: company,
      });
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '500px',
          width: '90%',
        }}
      >
        <h2 style={{ margin: '0 0 20px 0', fontSize: '20px', fontWeight: '700', color: NAVY }}>Enroll Prospect</h2>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Sequence
          </label>
          <select
            value={sequenceId}
            onChange={(e) => setSequenceId(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: `1px solid #E5E7EB`,
              borderRadius: '6px',
              fontSize: '14px',
            }}
          >
            <option value="">Select a sequence</option>
            {sequences.map((seq) => (
              <option key={seq.id} value={seq.id}>
                {seq.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Prospect Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., John Smith"
            style={{
              width: '100%',
              padding: '8px 12px',
              border: `1px solid #E5E7EB`,
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="john@example.com"
            style={{
              width: '100%',
              padding: '8px 12px',
              border: `1px solid #E5E7EB`,
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: '#374151', marginBottom: '6px' }}>
            Company
          </label>
          <input
            type="text"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Acme Corp"
            style={{
              width: '100%',
              padding: '8px 12px',
              border: `1px solid #E5E7EB`,
              borderRadius: '6px',
              fontSize: '14px',
              boxSizing: 'border-box',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: '#E5E7EB',
              color: '#374151',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!sequenceId || !email || !name || !company}
            style={{
              padding: '8px 16px',
              backgroundColor: !sequenceId || !email || !name || !company ? '#D1D5DB' : NAVY,
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: !sequenceId || !email || !name || !company ? 'not-allowed' : 'pointer',
            }}
          >
            Enroll Prospect
          </button>
        </div>
      </div>
    </div>
  );
}

function TemplateDetailModal({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const highlightVariables = (text: string) => {
    return text.split(/(\{\{[^}]+\}\})/g).map((part, idx) => (
      <span key={idx} style={{ color: part.startsWith('{{') ? ORANGE : '#374151' }}>
        {part}
      </span>
    ));
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflowY: 'auto',
          width: '90%',
        }}
      >
        <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '700', color: NAVY }}>{template.name}</h2>

        <span
          style={{
            display: 'inline-block',
            padding: '4px 8px',
            backgroundColor: ORANGE,
            color: 'white',
            borderRadius: '4px',
            fontSize: '12px',
            fontWeight: '600',
            marginBottom: '20px',
          }}
        >
          {template.type}
        </span>

        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600', color: NAVY }}>Subject</h3>
          <div style={{ padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '6px', fontSize: '14px', lineHeight: '1.6' }}>
            {highlightVariables(template.subject)}
          </div>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <h3 style={{ margin: '0 0 8px 0', fontSize: '14px', fontWeight: '600', color: NAVY }}>Body</h3>
          <div style={{ padding: '12px', backgroundColor: '#F9FAFB', borderRadius: '6px', fontSize: '14px', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
            {highlightVariables(template.body)}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 16px',
              backgroundColor: NAVY,
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '14px',
              fontWeight: '600',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
