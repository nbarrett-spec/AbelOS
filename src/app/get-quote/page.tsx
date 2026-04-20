'use client';

import { useState, useEffect } from 'react';

// Types
interface DoorLine {
  id: string;
  type: string;
  size: string;
  handing: string;
  core: string;
  panelStyle: string;
  jambSize: string;
  quantity: number;
}

interface BuilderInfo {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  isNew: boolean;
}

interface ProjectDetails {
  projectName: string;
  projectAddress: string;
  community: string;
  estimatedDoors: number;
  targetDeliveryDate: string;
}

interface QuoteState {
  step: number;
  builderInfo: BuilderInfo;
  projectDetails: ProjectDetails;
  doorLines: DoorLine[];
  notes: string;
  submitting: boolean;
  submitted: boolean;
}

// Pricing logic
const calculateDoorPrice = (door: DoorLine): { min: number; max: number } => {
  let baseMin = 0;
  let baseMax = 0;

  // Base price by door type
  switch (door.type) {
    case 'interior-prehung':
      baseMin = 85;
      baseMax = 185;
      break;
    case 'exterior-prehung':
      baseMin = 250;
      baseMax = 650;
      break;
    case 'bifold':
      baseMin = 120;
      baseMax = 280;
      break;
    case 'barn-door':
      baseMin = 180;
      baseMax = 400;
      break;
    case 'french-door':
      baseMin = 350;
      baseMax = 800;
      break;
    case 'pocket-door':
      baseMin = 200;
      baseMax = 450;
      break;
    case 'slab-only':
      baseMin = 35;
      baseMax = 120;
      break;
    default:
      baseMin = 75;
      baseMax = 150;
  }

  // Core multiplier
  let coreMultiplier = 1;
  if (door.core === 'solid') {
    coreMultiplier = 1.3;
  } else if (door.core === 'fire-rated') {
    coreMultiplier = 1.6;
  }

  // Panel complexity multiplier
  let panelMultiplier = 1;
  switch (door.panelStyle) {
    case 'flat':
      panelMultiplier = 1;
      break;
    case '2-panel':
      panelMultiplier = 1.15;
      break;
    case '6-panel':
      panelMultiplier = 1.25;
      break;
    case 'shaker':
      panelMultiplier = 1.3;
      break;
    case 'craftsman':
      panelMultiplier = 1.35;
      break;
    case 'barn':
      panelMultiplier = 1.4;
      break;
    case 'glass':
      panelMultiplier = 1.45;
      break;
    default:
      panelMultiplier = 1;
  }

  return {
    min: Math.round(baseMin * coreMultiplier * panelMultiplier),
    max: Math.round(baseMax * coreMultiplier * panelMultiplier),
  };
};

const getTotalEstimate = (doors: DoorLine[]): { min: number; max: number } => {
  let totalMin = 0;
  let totalMax = 0;

  doors.forEach((door) => {
    const price = calculateDoorPrice(door);
    totalMin += price.min * door.quantity;
    totalMax += price.max * door.quantity;
  });

  return { min: totalMin, max: totalMax };
};

export default function GetQuotePage() {
  const [state, setState] = useState<QuoteState>({
    step: 1,
    builderInfo: {
      companyName: '',
      contactName: '',
      email: '',
      phone: '',
      isNew: false,
    },
    projectDetails: {
      projectName: '',
      projectAddress: '',
      community: '',
      estimatedDoors: 0,
      targetDeliveryDate: '',
    },
    doorLines: [],
    notes: '',
    submitting: false,
    submitted: false,
  });

  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('abel-quote-draft');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setState(parsed);
      } catch (e) {
        // Ignore parse errors
      }
    }
  }, []);

  // Save to localStorage whenever state changes
  useEffect(() => {
    localStorage.setItem('abel-quote-draft', JSON.stringify(state));
  }, [state]);

  const updateBuilderInfo = (field: keyof BuilderInfo, value: any) => {
    setState((prev) => ({
      ...prev,
      builderInfo: { ...prev.builderInfo, [field]: value },
    }));
  };

  const updateProjectDetails = (field: keyof ProjectDetails, value: any) => {
    setState((prev) => ({
      ...prev,
      projectDetails: { ...prev.projectDetails, [field]: value },
    }));
  };

  const updateDoorLine = (id: string, field: keyof DoorLine, value: any) => {
    setState((prev) => ({
      ...prev,
      doorLines: prev.doorLines.map((door) =>
        door.id === id ? { ...door, [field]: value } : door
      ),
    }));
  };

  const addDoorLine = () => {
    const newDoor: DoorLine = {
      id: Date.now().toString(),
      type: 'interior-prehung',
      size: '2/0 x 6/8',
      handing: 'LH',
      core: 'hollow',
      panelStyle: 'flat',
      jambSize: '4-9/16',
      quantity: 1,
    };
    setState((prev) => ({
      ...prev,
      doorLines: [...prev.doorLines, newDoor],
    }));
  };

  const removeDoorLine = (id: string) => {
    setState((prev) => ({
      ...prev,
      doorLines: prev.doorLines.filter((door) => door.id !== id),
    }));
  };

  const validateStep = (stepNum: number): boolean => {
    const errors: Record<string, string> = {};

    if (stepNum === 1) {
      if (!state.builderInfo.companyName.trim()) {
        errors.companyName = 'Company name is required';
      }
      if (!state.builderInfo.contactName.trim()) {
        errors.contactName = 'Contact name is required';
      }
      if (!state.builderInfo.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.builderInfo.email)) {
        errors.email = 'Valid email is required';
      }
      if (!state.builderInfo.phone.trim()) {
        errors.phone = 'Phone number is required';
      }
    }

    if (stepNum === 2) {
      if (!state.projectDetails.projectName.trim()) {
        errors.projectName = 'Project name is required';
      }
      if (!state.projectDetails.projectAddress.trim()) {
        errors.projectAddress = 'Project address is required';
      }
      if (!state.projectDetails.targetDeliveryDate) {
        errors.targetDeliveryDate = 'Target delivery date is required';
      }
    }

    if (stepNum === 3) {
      if (state.doorLines.length === 0) {
        errors.doorLines = 'Please add at least one door line';
      }
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const goToStep = (stepNum: number) => {
    if (stepNum < state.step) {
      setState((prev) => ({ ...prev, step: stepNum }));
      setValidationErrors({});
      return;
    }

    if (validateStep(state.step)) {
      setState((prev) => ({ ...prev, step: stepNum }));
      setValidationErrors({});
    }
  };

  const handleSubmit = async () => {
    if (!validateStep(4)) {
      return;
    }

    setState((prev) => ({ ...prev, submitting: true }));

    try {
      const response = await fetch('/api/quote-request/instant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          builderInfo: state.builderInfo,
          projectDetails: state.projectDetails,
          doorLines: state.doorLines,
          notes: state.notes,
          estimate: getTotalEstimate(state.doorLines),
        }),
      });

      if (response.ok) {
        setState((prev) => ({
          ...prev,
          submitting: false,
          submitted: true,
        }));
        localStorage.removeItem('abel-quote-draft');

        // Reset after 5 seconds
        setTimeout(() => {
          setState({
            step: 1,
            builderInfo: {
              companyName: '',
              contactName: '',
              email: '',
              phone: '',
              isNew: false,
            },
            projectDetails: {
              projectName: '',
              projectAddress: '',
              community: '',
              estimatedDoors: 0,
              targetDeliveryDate: '',
            },
            doorLines: [],
            notes: '',
            submitting: false,
            submitted: false,
          });
        }, 5000);
      } else {
        alert('Failed to submit quote. Please try again.');
        setState((prev) => ({ ...prev, submitting: false }));
      }
    } catch (error) {
      alert('Error submitting quote. Please try again.');
      setState((prev) => ({ ...prev, submitting: false }));
    }
  };

  // Styles
  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#F8F9FA',
      padding: '0',
      margin: '0',
    },
    header: {
      backgroundColor: 'white',
      borderBottom: '1px solid #E0E0E0',
      padding: '20px',
      textAlign: 'center' as const,
      boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
    },
    headerContent: {
      maxWidth: '1200px',
      margin: '0 auto',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    logo: {
      fontSize: '24px',
      fontWeight: 'bold' as const,
      color: '#3E2A1E',
    },
    logoOrange: {
      color: '#C9822B',
    },
    headerText: {
      fontSize: '14px',
      color: '#666',
    },
    callbackButton: {
      backgroundColor: '#C9822B',
      color: 'white',
      padding: '10px 20px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold' as const,
      boxShadow: '0 2px 8px rgba(230, 126, 34, 0.3)',
    },
    main: {
      maxWidth: '1000px',
      margin: '0 auto',
      padding: '30px 20px',
    },
    progressBar: {
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '40px',
      position: 'relative' as const,
    },
    progressStep: (isActive: boolean, isComplete: boolean) => ({
      flex: 1,
      textAlign: 'center' as const,
      position: 'relative' as const,
    }),
    progressCircle: (isActive: boolean, isComplete: boolean) => ({
      width: '40px',
      height: '40px',
      borderRadius: '50%',
      backgroundColor: isActive ? '#C9822B' : isComplete ? '#3E2A1E' : '#E0E0E0',
      color: isActive || isComplete ? 'white' : '#999',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 10px',
      fontWeight: 'bold' as const,
      fontSize: '14px',
    }),
    progressLabel: (isActive: boolean) => ({
      fontSize: '12px',
      color: isActive ? '#C9822B' : '#666',
      fontWeight: isActive ? ('bold' as const) : ('normal' as const),
    }),
    progressLine: {
      position: 'absolute' as const,
      top: '20px',
      left: '50%',
      right: '-50%',
      height: '2px',
      backgroundColor: '#E0E0E0',
      zIndex: -1,
    },
    card: {
      backgroundColor: 'white',
      padding: '30px',
      borderRadius: '8px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      marginBottom: '20px',
    },
    formGroup: {
      marginBottom: '20px',
    },
    label: {
      display: 'block',
      marginBottom: '8px',
      fontSize: '14px',
      fontWeight: '600' as const,
      color: '#3E2A1E',
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #D0D0D0',
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
      boxSizing: 'border-box' as const,
      transition: 'border-color 0.2s',
    },
    inputFocus: {
      outline: 'none',
      borderColor: '#C9822B',
      boxShadow: '0 0 0 3px rgba(230, 126, 34, 0.1)',
    },
    select: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #D0D0D0',
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
      boxSizing: 'border-box' as const,
      backgroundColor: 'white',
      cursor: 'pointer',
    },
    textarea: {
      width: '100%',
      padding: '10px 12px',
      border: '1px solid #D0D0D0',
      borderRadius: '4px',
      fontSize: '14px',
      fontFamily: 'inherit',
      boxSizing: 'border-box' as const,
      minHeight: '100px',
      resize: 'vertical' as const,
    },
    error: {
      color: '#D32F2F',
      fontSize: '12px',
      marginTop: '4px',
    },
    twoColumn: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: '20px',
    },
    threeColumn: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr 1fr',
      gap: '15px',
    },
    toggle: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: '10px',
    },
    toggleCheckbox: {
      marginRight: '10px',
      cursor: 'pointer',
      width: '18px',
      height: '18px',
    },
    toggleLabel: {
      fontSize: '14px',
      color: '#333',
      cursor: 'pointer',
    },
    doorLineCard: {
      backgroundColor: '#F8F9FA',
      padding: '20px',
      borderRadius: '4px',
      marginBottom: '15px',
      border: '1px solid #E0E0E0',
    },
    doorLineHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '15px',
    },
    doorLineTitle: {
      fontSize: '14px',
      fontWeight: 'bold' as const,
      color: '#3E2A1E',
    },
    removeButton: {
      backgroundColor: '#D32F2F',
      color: 'white',
      padding: '6px 12px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: 'bold' as const,
    },
    addButton: {
      backgroundColor: '#3E2A1E',
      color: 'white',
      padding: '12px 20px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold' as const,
      marginBottom: '20px',
      boxShadow: '0 2px 8px rgba(62, 42, 30, 0.2)',
    },
    priceEstimate: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '15px',
      backgroundColor: '#FFF8F0',
      borderRadius: '4px',
      marginTop: '20px',
      border: '1px solid #FFE5CC',
    },
    priceLabel: {
      fontSize: '14px',
      fontWeight: '600' as const,
      color: '#3E2A1E',
    },
    priceValue: {
      fontSize: '18px',
      fontWeight: 'bold' as const,
      color: '#C9822B',
    },
    summaryRow: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '12px 0',
      borderBottom: '1px solid #E0E0E0',
      fontSize: '14px',
    },
    summaryRowLast: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '12px 0',
      borderBottom: 'none',
      fontSize: '14px',
    },
    summaryTotal: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: '15px 0',
      marginTop: '15px',
      borderTop: '2px solid #3E2A1E',
      fontSize: '16px',
      fontWeight: 'bold' as const,
      color: '#3E2A1E',
    },
    buttonGroup: {
      display: 'flex',
      gap: '10px',
      marginTop: '30px',
      justifyContent: 'flex-end',
    },
    backButton: {
      backgroundColor: '#E0E0E0',
      color: '#333',
      padding: '12px 24px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold' as const,
    },
    nextButton: {
      backgroundColor: '#C9822B',
      color: 'white',
      padding: '12px 24px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold' as const,
      boxShadow: '0 2px 8px rgba(230, 126, 34, 0.3)',
    },
    submitButton: {
      backgroundColor: '#3E2A1E',
      color: 'white',
      padding: '12px 24px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: 'bold' as const,
      boxShadow: '0 2px 8px rgba(62, 42, 30, 0.3)',
    },
    disabledButton: {
      opacity: 0.6,
      cursor: 'not-allowed',
    },
    successMessage: {
      backgroundColor: '#E8F5E9',
      border: '2px solid #4CAF50',
      borderRadius: '8px',
      padding: '30px',
      textAlign: 'center' as const,
      marginTop: '30px',
    },
    successTitle: {
      fontSize: '24px',
      fontWeight: 'bold' as const,
      color: '#2E7D32',
      marginBottom: '10px',
    },
    successText: {
      fontSize: '16px',
      color: '#558B2F',
      marginBottom: '15px',
    },
    successSubtext: {
      fontSize: '14px',
      color: '#666',
    },
    footer: {
      backgroundColor: '#3E2A1E',
      color: 'white',
      textAlign: 'center' as const,
      padding: '30px 20px',
      marginTop: '50px',
    },
    footerContent: {
      maxWidth: '1200px',
      margin: '0 auto',
    },
    footerText: {
      fontSize: '14px',
      marginBottom: '10px',
    },
    footerLink: {
      color: '#C9822B',
      textDecoration: 'none',
      fontWeight: 'bold' as const,
    },
    responsiveHide: {
      display: 'none',
    },
  };

  // Handle responsive design
  useEffect(() => {
    const handleResize = () => {
      // This will trigger re-renders on resize, but we're using media query principles in CSS
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const doorOptions = {
    type: [
      { value: 'interior-prehung', label: 'Interior Prehung' },
      { value: 'exterior-prehung', label: 'Exterior Prehung' },
      { value: 'bifold', label: 'Bifold' },
      { value: 'barn-door', label: 'Barn Door' },
      { value: 'french-door', label: 'French Door' },
      { value: 'pocket-door', label: 'Pocket Door' },
      { value: 'slab-only', label: 'Slab Only' },
    ],
    size: [
      { value: '2/0 x 6/8', label: '2/0 x 6/8' },
      { value: '2/4 x 6/8', label: '2/4 x 6/8' },
      { value: '2/6 x 6/8', label: '2/6 x 6/8' },
      { value: '2/8 x 6/8', label: '2/8 x 6/8' },
      { value: '3/0 x 6/8', label: '3/0 x 6/8' },
      { value: '3/0 x 8/0', label: '3/0 x 8/0' },
      { value: '5/0 x 6/8', label: '5/0 x 6/8' },
      { value: '6/0 x 6/8', label: '6/0 x 6/8' },
      { value: 'custom', label: 'Custom' },
    ],
    handing: [
      { value: 'LH', label: 'LH' },
      { value: 'RH', label: 'RH' },
      { value: 'n/a', label: 'N/A' },
    ],
    core: [
      { value: 'hollow', label: 'Hollow' },
      { value: 'solid', label: 'Solid' },
      { value: 'fire-rated', label: 'Fire-Rated' },
    ],
    panelStyle: [
      { value: 'flat', label: 'Flat' },
      { value: '2-panel', label: '2-Panel' },
      { value: '6-panel', label: '6-Panel' },
      { value: 'shaker', label: 'Shaker' },
      { value: 'craftsman', label: 'Craftsman' },
      { value: 'barn', label: 'Barn' },
      { value: 'glass', label: 'Glass' },
    ],
    jambSize: [
      { value: '4-9/16', label: '4-9/16' },
      { value: '5-1/4', label: '5-1/4' },
      { value: '6-9/16', label: '6-9/16' },
      { value: 'custom', label: 'Custom' },
    ],
  };

  const estimate = getTotalEstimate(state.doorLines);

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <div style={styles.logo}>
            Abel <span style={styles.logoOrange}>Lumber</span>
          </div>
          <button
            style={styles.callbackButton}
            onClick={() => alert('Callback request feature: Phone number capture and scheduling')}
          >
            Get a Callback
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {state.submitted ? (
          <div style={styles.successMessage}>
            <div style={styles.successTitle}>Thank You!</div>
            <div style={styles.successText}>
              Your quote has been submitted successfully.
            </div>
            <div style={styles.successSubtext}>
              A member of our team will follow up within 2 hours with your custom quote.
            </div>
          </div>
        ) : (
          <>
            {/* Progress Bar */}
            <div style={styles.progressBar}>
              {[1, 2, 3, 4].map((step) => (
                <div key={step} style={styles.progressStep(state.step === step, step < state.step)}>
                  <div
                    style={styles.progressCircle(state.step === step, step < state.step)}
                    onClick={() => goToStep(step)}
                  >
                    {step < state.step ? '✓' : step}
                  </div>
                  <div style={styles.progressLabel(state.step === step)}>
                    {step === 1 && 'Builder Info'}
                    {step === 2 && 'Project Details'}
                    {step === 3 && 'Door Config'}
                    {step === 4 && 'Review'}
                  </div>
                  {step < 4 && <div style={styles.progressLine} />}
                </div>
              ))}
            </div>

            {/* Step 1: Builder Info */}
            {state.step === 1 && (
              <div style={styles.card}>
                <h2 style={{ color: '#3E2A1E', marginBottom: '20px' }}>Builder Information</h2>
                <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
                  Tell us about your company. This information is required to save your quote.
                </p>

                <div style={styles.twoColumn}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Company Name *</label>
                    <input
                      style={styles.input}
                      type="text"
                      value={state.builderInfo.companyName}
                      onChange={(e) => updateBuilderInfo('companyName', e.target.value)}
                      placeholder="ABC Homes, Inc."
                    />
                    {validationErrors.companyName && (
                      <div style={styles.error}>{validationErrors.companyName}</div>
                    )}
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Contact Name *</label>
                    <input
                      style={styles.input}
                      type="text"
                      value={state.builderInfo.contactName}
                      onChange={(e) => updateBuilderInfo('contactName', e.target.value)}
                      placeholder="John Smith"
                    />
                    {validationErrors.contactName && (
                      <div style={styles.error}>{validationErrors.contactName}</div>
                    )}
                  </div>
                </div>

                <div style={styles.twoColumn}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Email *</label>
                    <input
                      style={styles.input}
                      type="email"
                      value={state.builderInfo.email}
                      onChange={(e) => updateBuilderInfo('email', e.target.value)}
                      placeholder="john@abchomes.com"
                    />
                    {validationErrors.email && (
                      <div style={styles.error}>{validationErrors.email}</div>
                    )}
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Phone Number *</label>
                    <input
                      style={styles.input}
                      type="tel"
                      value={state.builderInfo.phone}
                      onChange={(e) => updateBuilderInfo('phone', e.target.value)}
                      placeholder="(972) 555-0000"
                    />
                    {validationErrors.phone && (
                      <div style={styles.error}>{validationErrors.phone}</div>
                    )}
                  </div>
                </div>

                <div style={styles.toggle}>
                  <input
                    style={styles.toggleCheckbox}
                    type="checkbox"
                    id="isNew"
                    checked={state.builderInfo.isNew}
                    onChange={(e) => updateBuilderInfo('isNew', e.target.checked)}
                  />
                  <label style={styles.toggleLabel} htmlFor="isNew">
                    New to Abel Lumber?
                  </label>
                </div>

                <div style={styles.buttonGroup}>
                  <button
                    style={{ ...styles.nextButton }}
                    onClick={() => goToStep(2)}
                  >
                    Next: Project Details →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Project Details */}
            {state.step === 2 && (
              <div style={styles.card}>
                <h2 style={{ color: '#3E2A1E', marginBottom: '20px' }}>Project Details</h2>
                <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
                  Help us understand your project scope and timeline.
                </p>

                <div style={styles.twoColumn}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Project Name *</label>
                    <input
                      style={styles.input}
                      type="text"
                      value={state.projectDetails.projectName}
                      onChange={(e) => updateProjectDetails('projectName', e.target.value)}
                      placeholder="Meadowbrook Phase 2"
                    />
                    {validationErrors.projectName && (
                      <div style={styles.error}>{validationErrors.projectName}</div>
                    )}
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Project Address *</label>
                    <input
                      style={styles.input}
                      type="text"
                      value={state.projectDetails.projectAddress}
                      onChange={(e) => updateProjectDetails('projectAddress', e.target.value)}
                      placeholder="1234 Oak Lane, Dallas, TX 75001"
                    />
                    {validationErrors.projectAddress && (
                      <div style={styles.error}>{validationErrors.projectAddress}</div>
                    )}
                  </div>
                </div>

                <div style={styles.twoColumn}>
                  <div style={styles.formGroup}>
                    <label style={styles.label}>Community / Subdivision (Optional)</label>
                    <input
                      style={styles.input}
                      type="text"
                      value={state.projectDetails.community}
                      onChange={(e) => updateProjectDetails('community', e.target.value)}
                      placeholder="Willow Creek Estates"
                    />
                  </div>

                  <div style={styles.formGroup}>
                    <label style={styles.label}>Estimated Number of Doors</label>
                    <input
                      style={styles.input}
                      type="number"
                      min="0"
                      value={state.projectDetails.estimatedDoors}
                      onChange={(e) => updateProjectDetails('estimatedDoors', parseInt(e.target.value) || 0)}
                      placeholder="0"
                    />
                  </div>
                </div>

                <div style={styles.formGroup}>
                  <label style={styles.label}>Target Delivery Date *</label>
                  <input
                    style={styles.input}
                    type="date"
                    value={state.projectDetails.targetDeliveryDate}
                    onChange={(e) => updateProjectDetails('targetDeliveryDate', e.target.value)}
                  />
                  {validationErrors.targetDeliveryDate && (
                    <div style={styles.error}>{validationErrors.targetDeliveryDate}</div>
                  )}
                </div>

                <div style={styles.buttonGroup}>
                  <button style={styles.backButton} onClick={() => goToStep(1)}>
                    ← Back
                  </button>
                  <button style={styles.nextButton} onClick={() => goToStep(3)}>
                    Next: Door Configuration →
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Door Configuration */}
            {state.step === 3 && (
              <div style={styles.card}>
                <h2 style={{ color: '#3E2A1E', marginBottom: '20px' }}>Door Configuration</h2>
                <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
                  Add each door line with specifications. Prices are estimates based on your selections.
                </p>

                {validationErrors.doorLines && (
                  <div style={styles.error}>{validationErrors.doorLines}</div>
                )}

                <button style={styles.addButton} onClick={addDoorLine}>
                  + Add Door Line
                </button>

                {state.doorLines.map((door) => (
                  <div key={door.id} style={styles.doorLineCard}>
                    <div style={styles.doorLineHeader}>
                      <div style={styles.doorLineTitle}>
                        {doorOptions.type.find((t) => t.value === door.type)?.label} -{' '}
                        {doorOptions.size.find((s) => s.value === door.size)?.label}
                      </div>
                      <button
                        style={styles.removeButton}
                        onClick={() => removeDoorLine(door.id)}
                      >
                        Remove
                      </button>
                    </div>

                    <div style={styles.threeColumn}>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Door Type</label>
                        <select
                          style={styles.select}
                          value={door.type}
                          onChange={(e) => updateDoorLine(door.id, 'type', e.target.value)}
                        >
                          {doorOptions.type.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>Size</label>
                        <select
                          style={styles.select}
                          value={door.size}
                          onChange={(e) => updateDoorLine(door.id, 'size', e.target.value)}
                        >
                          {doorOptions.size.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>Handing</label>
                        <select
                          style={styles.select}
                          value={door.handing}
                          onChange={(e) => updateDoorLine(door.id, 'handing', e.target.value)}
                        >
                          {doorOptions.handing.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={styles.threeColumn}>
                      <div style={styles.formGroup}>
                        <label style={styles.label}>Core</label>
                        <select
                          style={styles.select}
                          value={door.core}
                          onChange={(e) => updateDoorLine(door.id, 'core', e.target.value)}
                        >
                          {doorOptions.core.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>Panel Style</label>
                        <select
                          style={styles.select}
                          value={door.panelStyle}
                          onChange={(e) => updateDoorLine(door.id, 'panelStyle', e.target.value)}
                        >
                          {doorOptions.panelStyle.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div style={styles.formGroup}>
                        <label style={styles.label}>Jamb Size</label>
                        <select
                          style={styles.select}
                          value={door.jambSize}
                          onChange={(e) => updateDoorLine(door.id, 'jambSize', e.target.value)}
                        >
                          {doorOptions.jambSize.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div style={styles.formGroup}>
                      <label style={styles.label}>Quantity</label>
                      <input
                        style={styles.input}
                        type="number"
                        min="1"
                        value={door.quantity}
                        onChange={(e) =>
                          updateDoorLine(door.id, 'quantity', parseInt(e.target.value) || 1)
                        }
                      />
                    </div>

                    {(() => {
                      const doorPrice = calculateDoorPrice(door);
                      return (
                        <div style={styles.priceEstimate}>
                          <span style={styles.priceLabel}>
                            Qty {door.quantity} × ${doorPrice.min}-${doorPrice.max} each
                          </span>
                          <span style={styles.priceValue}>
                            ${doorPrice.min * door.quantity}-${doorPrice.max * door.quantity}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                ))}

                {state.doorLines.length > 0 && (
                  <div style={styles.priceEstimate}>
                    <span style={styles.priceLabel}>Estimated Total</span>
                    <span style={styles.priceValue}>
                      ${estimate.min.toLocaleString()}-${estimate.max.toLocaleString()}
                    </span>
                  </div>
                )}

                <div style={styles.buttonGroup}>
                  <button style={styles.backButton} onClick={() => goToStep(2)}>
                    ← Back
                  </button>
                  <button style={styles.nextButton} onClick={() => goToStep(4)}>
                    Next: Review & Submit →
                  </button>
                </div>
              </div>
            )}

            {/* Step 4: Review & Submit */}
            {state.step === 4 && (
              <div style={styles.card}>
                <h2 style={{ color: '#3E2A1E', marginBottom: '20px' }}>Review & Submit</h2>
                <p style={{ color: '#666', marginBottom: '20px', fontSize: '14px' }}>
                  Review your quote before submitting. A specialist will contact you shortly.
                </p>

                {/* Builder Info Summary */}
                <div style={{ marginBottom: '30px' }}>
                  <h3 style={{ color: '#3E2A1E', fontSize: '16px', marginBottom: '15px' }}>
                    Builder Information
                  </h3>
                  <div style={styles.summaryRow}>
                    <span style={{ fontWeight: '600' }}>Company</span>
                    <span>{state.builderInfo.companyName}</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span style={{ fontWeight: '600' }}>Contact</span>
                    <span>{state.builderInfo.contactName}</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span style={{ fontWeight: '600' }}>Email</span>
                    <span>{state.builderInfo.email}</span>
                  </div>
                  <div style={styles.summaryRowLast}>
                    <span style={{ fontWeight: '600' }}>Phone</span>
                    <span>{state.builderInfo.phone}</span>
                  </div>
                </div>

                {/* Project Details Summary */}
                <div style={{ marginBottom: '30px' }}>
                  <h3 style={{ color: '#3E2A1E', fontSize: '16px', marginBottom: '15px' }}>
                    Project Details
                  </h3>
                  <div style={styles.summaryRow}>
                    <span style={{ fontWeight: '600' }}>Project Name</span>
                    <span>{state.projectDetails.projectName}</span>
                  </div>
                  <div style={styles.summaryRow}>
                    <span style={{ fontWeight: '600' }}>Address</span>
                    <span>{state.projectDetails.projectAddress}</span>
                  </div>
                  {state.projectDetails.community && (
                    <div style={styles.summaryRow}>
                      <span style={{ fontWeight: '600' }}>Community</span>
                      <span>{state.projectDetails.community}</span>
                    </div>
                  )}
                  <div style={styles.summaryRow}>
                    <span style={{ fontWeight: '600' }}>Estimated Doors</span>
                    <span>{state.projectDetails.estimatedDoors}</span>
                  </div>
                  <div style={styles.summaryRowLast}>
                    <span style={{ fontWeight: '600' }}>Target Delivery</span>
                    <span>{state.projectDetails.targetDeliveryDate}</span>
                  </div>
                </div>

                {/* Door Lines Summary */}
                <div style={{ marginBottom: '30px' }}>
                  <h3 style={{ color: '#3E2A1E', fontSize: '16px', marginBottom: '15px' }}>
                    Door Configuration
                  </h3>
                  {state.doorLines.map((door, index) => {
                    const price = calculateDoorPrice(door);
                    return (
                      <div key={door.id} style={{ marginBottom: '15px' }}>
                        <div style={styles.summaryRow}>
                          <span style={{ fontWeight: '600' }}>
                            Door {index + 1}: {doorOptions.type.find((t) => t.value === door.type)?.label}
                          </span>
                          <span>
                            {doorOptions.size.find((s) => s.value === door.size)?.label} | Qty {door.quantity}
                          </span>
                        </div>
                        <div style={styles.summaryRow}>
                          <span style={{ fontSize: '13px', color: '#666' }}>
                            {doorOptions.core.find((c) => c.value === door.core)?.label} |{' '}
                            {doorOptions.panelStyle.find((p) => p.value === door.panelStyle)?.label} |{' '}
                            {doorOptions.jambSize.find((j) => j.value === door.jambSize)?.label}
                          </span>
                          <span style={{ fontWeight: '600', color: '#C9822B' }}>
                            ${price.min * door.quantity}-${price.max * door.quantity}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  <div style={styles.summaryTotal}>
                    <span>Estimated Total</span>
                    <span>${estimate.min.toLocaleString()}-${estimate.max.toLocaleString()}</span>
                  </div>
                </div>

                {/* Notes */}
                <div style={styles.formGroup}>
                  <label style={styles.label}>
                    Special Instructions or Notes (Optional)
                  </label>
                  <textarea
                    style={styles.textarea}
                    value={state.notes}
                    onChange={(e) => setState((prev) => ({ ...prev, notes: e.target.value }))}
                    placeholder="Any special requirements, color preferences, or additional information..."
                  />
                </div>

                <div style={styles.buttonGroup}>
                  <button style={styles.backButton} onClick={() => goToStep(3)}>
                    ← Back
                  </button>
                  <button
                    style={{
                      ...styles.submitButton,
                      ...(state.submitting ? styles.disabledButton : {}),
                    }}
                    onClick={handleSubmit}
                    disabled={state.submitting}
                  >
                    {state.submitting ? 'Submitting...' : 'Submit Quote Request'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer style={styles.footer}>
        <div style={styles.footerContent}>
          <div style={styles.footerText}>
            <strong>Abel Lumber</strong>
          </div>
          <div style={styles.footerText}>
            Phone: <a href="tel:+19725550000" style={styles.footerLink}>(972) 555-0000</a>
          </div>
          <div style={styles.footerText}>
            Email: <a href="mailto:quotes@abellumber.com" style={styles.footerLink}>quotes@abellumber.com</a>
          </div>
          <div style={styles.footerText}>
            Serving Dallas-Fort Worth builders since 1985
          </div>
        </div>
      </footer>

      {/* Mobile Responsive Styles - added inline for completeness */}
      <style>
        {`
          @media (max-width: 768px) {
            [data-grid-two-col] {
              display: grid !important;
              grid-template-columns: 1fr !important;
            }
            [data-grid-three-col] {
              display: grid !important;
              grid-template-columns: 1fr !important;
            }
          }
          input, select, textarea {
            font-size: 16px;
          }
          button {
            transition: all 0.2s ease;
          }
          button:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          }
          button:active:not(:disabled) {
            transform: translateY(0);
          }
        `}
      </style>
    </div>
  );
}
