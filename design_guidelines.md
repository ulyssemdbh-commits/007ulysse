# Ulysse AI Assistant - Comprehensive Design Guidelines

## Design Approach
**Hybrid Reference-Based**: Drawing from Linear's refined data density, Apple's spatial design principles, and Arc browser's innovative UI paradigms. Dark theme glassmorphism creates depth while maintaining clarity for productivity-focused AI interactions.

## Typography
- **Primary Font**: Inter (Google Fonts CDN) - optimal for dark interfaces
- **Scale**:
  - App headers: text-2xl/text-3xl (semibold, 600)
  - Section titles: text-lg/text-xl (medium, 500)
  - Body/Chat: text-sm/text-base (regular, 400)
  - Labels/Meta: text-xs/text-sm (medium, 500)
  - Numbers/Stats: tabular-nums for alignment

## Layout System
**Spacing primitives**: Tailwind units of 2, 3, 4, 6, 8, 12, 16
- Dashboard sidebar: w-64 (collapsed: w-16)
- Main content: flex-1 with max-w-screen-2xl
- Mobile: px-4, py-3 for sections
- Desktop: px-6, py-4 for sections
- Component padding: p-4 to p-6

## Color Strategy
**Dark Theme Foundation** with blue/indigo AI accents:
- Backgrounds use dark grays/blacks with glassmorphism overlays
- AI elements: blue-500 to indigo-600 range for highlights
- Text hierarchy: white (primary), gray-300 (secondary), gray-500 (tertiary)
- Glassmorphism: backdrop-blur-xl with bg-white/5 to bg-white/10

## Core Components

### Desktop Dashboard Layout
**Three-column structure**:
- **Left Sidebar** (w-64, collapsible to w-16): 
  - App logo + user profile (top)
  - Primary navigation (Chat, Email, Calendar, Files, Map)
  - Voice input button (bottom, always accessible)
  - Icons: Heroicons solid variants
- **Center Panel** (flex-1): Active feature workspace
  - Chat interface, email list, calendar grid, file browser, or map view
  - Header bar with context title + search + filters
- **Right Contextual Panel** (w-80, slides in/out):
  - Chat: Conversation settings, file attachments
  - Email: Thread details, quick actions
  - Calendar: Event details, attendees
  - Files: Metadata, preview, sharing
  - Auto-collapses when not in use

### Mobile App Layout
**Bottom navigation** (safe-area aware):
- 5 primary tabs: Chat, Email, Calendar, Files, Map
- Floating voice button (bottom-right, elevated)
- Full-screen feature views
- Swipe gestures for contextual panels (slide from right)

### AI Chat Interface
- Message bubbles: rounded-2xl, p-3 to p-4
- User messages: align-right, blue-600 glassmorphism
- AI responses: align-left with avatar (40px circle), white/5 glassmorphism
- Voice waveform visualizer (center, 240px): appears during voice input/playback
- Input bar: sticky bottom, glassmorphic background, voice/text toggle
- Typing indicator: animated gradient dots

### Email Management
- Three-pane layout (desktop): List (40%) | Content (60%) | Details panel
- Email cards: p-4, rounded-lg, glassmorphism, unread indicator
- Quick actions: Archive, Star, Delete (icon buttons)
- Search bar with AI-powered filters

### Calendar View
- Month grid (default), week, day views
- Event blocks: color-coded by category, rounded corners
- Drag-to-create, click-to-edit
- Sidebar mini-calendar + upcoming events list

### File Browser
- Grid view (default, 4-6 columns) and list view toggle
- File cards: thumbnail preview, name, size, date
- Folder navigation breadcrumbs
- AI-suggested organization tags

### Map Integration
- Full-screen map canvas (Leaflet/Mapbox placeholder)
- Location markers with glassmorphic info cards
- Search bar overlay (top)
- Current location button (bottom-right)

### Voice Input Component
- Circular waveform (200px diameter, center-screen overlay)
- Pulsing animation during listening
- Transcription preview below
- Cancel button (bottom)

### Glassmorphism Cards
- Base: rounded-xl, p-6, backdrop-blur-xl
- Light variant: bg-white/10, border border-white/20
- Darker variant: bg-black/20, border border-white/10
- Shadows: shadow-lg to shadow-2xl

### Navigation Icons
**Heroicons CDN** (24px):
- Chat: chat-bubble-left-right
- Email: envelope
- Calendar: calendar-days
- Files: folder
- Map: map-pin
- Voice: microphone
- Settings: cog-6-tooth

## Glassmorphism Implementation
- **Primary surfaces**: bg-gray-900/80 backdrop-blur-xl
- **Secondary surfaces**: bg-gray-800/60 backdrop-blur-lg
- **Overlays**: bg-black/40 backdrop-blur-2xl
- **Borders**: border-white/10 to border-white/20
- **Shadows**: Layered shadows for depth (shadow-xl + shadow-blue-500/20)

## Animations
**Subtle & Functional**:
- Sidebar collapse: width transition (300ms ease-in-out)
- Panel slide-in: translate-x with backdrop fade (250ms)
- Voice waveform: smooth oscillation (CSS animation)
- Message appearance: opacity + translate-y-2 (200ms)
- Hover cards: scale-102 (desktop only)
- NO animations on buttons (self-managed states)

## Accessibility
- Keyboard shortcuts for navigation (Cmd+K search, Cmd+1-5 for tabs)
- ARIA labels on all icon-only buttons
- Focus indicators: ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-900
- Screen reader announcements for AI responses
- High contrast mode support
- Voice commands as primary alternative navigation

## Images

### Dashboard Hero/Empty State
**Description**: Abstract 3D geometric shapes with soft gradients (blue/indigo), subtle depth-of-field blur, dark space background with particle effects
**Placement**: Empty state for Chat, Calendar, Files (when no content)
**Treatment**: Centered, max-w-md, with call-to-action below

### Mobile App Screenshots
**Description**: High-fidelity mockups showing dark theme interface on iPhone with glassmorphism effects visible
**Placement**: Marketing materials (separate from app guidelines)
**Treatment**: Device frames with shadow-2xl

## Responsive Behavior
- Desktop: Three-column → Two-column (hide right panel) → Single column (below 1024px)
- Sidebar: Always visible desktop, drawer on mobile
- Cards: 4-col → 3-col → 2-col → 1-col grid
- Touch targets: 44x44px minimum on mobile
- Bottom nav: Fixed, with safe-area-inset-bottom padding