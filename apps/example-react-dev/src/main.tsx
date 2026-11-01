import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import '../../demo-studio.css'
import './style.css'

const host = document.getElementById('root')
if (!host) throw new Error('Color Studio requires its root element.')

createRoot(host).render(<App />)
