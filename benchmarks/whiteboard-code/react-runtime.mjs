import React from 'react';
import {createRoot} from 'react-dom/client';
window.React=React;window.renderBoard=(Board)=>createRoot(document.getElementById('stage')).render(React.createElement(Board));
