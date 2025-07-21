import React, { useState, useEffect, useRef, useCallback } from 'react';
import Gantt from 'frappe-gantt';
import '../node_modules/frappe-gantt/dist/frappe-gantt.css';
import './App.css';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

// --- Helper for dynamic CSS styles --- //
const StyleManager = {
  sheet: null,
  rules: new Set(),
  init: function() {
    if (this.sheet) return;
    const style = document.createElement("style");
    document.head.appendChild(style);
    this.sheet = style.sheet;
  },
  createClass: function(className, color) {
    if (!this.sheet) this.init();
    if (this.rules.has(className)) return;
    const rule = `.gantt-bar.${className} .bar { fill: ${color}; }`;
    const progressRule = `.gantt-bar.${className} .bar-progress { fill: ${color}; opacity: 0.6; }`;
    this.sheet.insertRule(rule, this.sheet.cssRules.length);
    this.sheet.insertRule(progressRule, this.sheet.cssRules.length);
    this.rules.add(className);
  }
};

// --- Login Screen Component --- //
const LoginScreen = ({ users, onLogin, error }) => (
  <div className="container vh-100 d-flex justify-content-center align-items-center">
    <div className="card shadow-sm text-center" style={{ width: '25rem' }}>
      <div className="card-header">
        <h4 className="my-2">Selecionar Usuário</h4>
      </div>
      <div className="card-body">
        {error && <div className="alert alert-danger">{error}</div>}
        <p>Escolha um perfil para continuar:</p>
        <div className="list-group">
          {users.map(user => (
            <button key={user} type="button" className="list-group-item list-group-item-action" onClick={() => onLogin(user)}>
              {user}
            </button>
          ))}
        </div>
      </div>
      <div className="card-footer text-muted">
        Equipe: RPA Gogroup
      </div>
    </div>
  </div>
);

// --- Main Gantt Component --- //
const GanttApp = ({ currentUser, onLogout }) => {
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState('individual'); // 'individual' or 'team'
  const [ganttViewMode, setGanttViewMode] = useState('Week');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);

  const ganttRef = useRef(null);
  const ganttInstance = useRef(null);
  const nameInputRef = useRef(null);

  // Helper function to format date
  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = String(date.getUTCMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const year = date.getUTCFullYear();
    return `${day}/${month}/${year}`;
  };

  const fetchTasks = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/tasks`);
      const data = await response.json();
      setTasks(data);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
      alert("Não foi possível carregar as tarefas. Verifique se o servidor backend está rodando.");
    }
  }, []);

  useEffect(() => {
    fetchTasks();
    StyleManager.init();
  }, [fetchTasks]);

  useEffect(() => {
    tasks.forEach(task => {
      if (task.custom_class && task.color) {
        StyleManager.createClass(task.custom_class, task.color);
      }
    });
  }, [tasks]);

  useEffect(() => {
    if (isModalOpen && nameInputRef.current) {
      setTimeout(() => nameInputRef.current.focus(), 1);
    }
  }, [isModalOpen]);

  const changeGanttViewMode = (mode) => {
    if (ganttInstance.current) {
      ganttInstance.current.change_view_mode(mode);
      setGanttViewMode(mode);
    }
  };

  const openModalToEdit = useCallback((task) => {
    setEditingTask(task);
    setIsModalOpen(true);
  }, []);

  const openModalToCreate = () => {
    setEditingTask({ name: '', start: '', end: '', color: '#0288d1', progress: 0 });
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingTask(null);
  };

  const handleDelete = useCallback(async (taskId) => {
    const taskToDelete = tasks.find(t => t.id === taskId);
    if (taskToDelete.owner !== currentUser) {
        alert("Você só pode excluir suas próprias tarefas.");
        return;
    }
    if (window.confirm('Tem certeza que deseja excluir esta tarefa?')) {
      try {
        const response = await fetch(`${API_URL}/tasks/${taskId}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentUser }), // Send currentUser in the body
        });
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || 'Falha ao excluir a tarefa.');
        }
        fetchTasks(); // Refetch tasks after deleting
      } catch (error) {
        console.error("Failed to delete task:", error);
        alert(error.message);
      }
    }
  }, [tasks, currentUser, fetchTasks]);

  const tasksToDisplay = view === 'individual'
    ? tasks.filter(t => t.owner === currentUser)
    : tasks.map(t => ({ ...t, name: `[${t.owner}] ${t.name}` }));

  useEffect(() => {
    if (ganttRef.current && tasksToDisplay.length > 0) {
      if (!ganttInstance.current) {
        // Initialize Gantt only once
        ganttInstance.current = new Gantt(ganttRef.current, tasksToDisplay, {
          on_click: (task) => {
            setTimeout(() => {
              const popup = document.querySelector('.gantt-popup');
              if (!popup || popup.querySelector('.btn')) return;
              
              const originalTask = tasks.find(t => t.id === task.id);
              if (!originalTask || originalTask.owner !== currentUser) return;

              const customActions = document.createElement('div');
              customActions.className = 'p-2 border-top mt-2 d-flex justify-content-end';
              customActions.innerHTML = `<button class="btn btn-sm btn-primary me-2">Editar</button><button class="btn btn-sm btn-danger">Excluir</button>`;
              customActions.querySelector('.btn-primary').onclick = () => openModalToEdit(originalTask);
              customActions.querySelector('.btn-danger').onclick = () => handleDelete(task.id);
              popup.appendChild(customActions);
            }, 0);
          },
          custom_popup_html: (task) => `<div class="p-2"><h5>${task.name}</h5><p class="mb-0">Progresso: ${task.progress}%</p></div>`
        });
        // Set initial view mode
        ganttInstance.current.change_view_mode(ganttViewMode);
      } else {
        // Refresh Gantt data when tasks change
        ganttInstance.current.refresh(tasksToDisplay);
      }
    }
  }, [tasksToDisplay, handleDelete, openModalToEdit, tasks, currentUser, ganttViewMode]);

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    if (!editingTask.name || !editingTask.start || !editingTask.end) {
      alert('Por favor, preencha nome, início e fim.');
      return;
    }

    const taskPayload = { ...editingTask, owner: currentUser };
    const isEditing = !!taskPayload.id;

    const url = isEditing ? `${API_URL}/tasks/${taskPayload.id}` : `${API_URL}/tasks`;
    const method = isEditing ? 'PUT' : 'POST';

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(taskPayload),
      });
      if (!response.ok) throw new Error('Network response was not ok');
      fetchTasks(); // Refetch tasks to get the latest state
      closeModal();
    } catch (error) {
      console.error("Failed to save task:", error);
      alert("Falha ao salvar a tarefa.");
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setEditingTask({ ...editingTask, [name]: value });
  };

  const listTasks = view === 'individual' ? tasks.filter(t => t.owner === currentUser) : tasks;

  return (
    <>
      <div className="container-fluid px-4 py-4">
        <div className="d-flex justify-content-between align-items-center mb-4">
          <div>
            <h1 className="h3 mb-0"><img src={`${process.env.PUBLIC_URL}/logo.png`} alt="Logo" style={{ width: '30px', marginRight: '10px' }} />Gantt Project Manager</h1>
            <p className="mb-0 text-muted">Usuário: {currentUser} | Visão: {view === 'individual' ? 'Minhas Tarefas' : 'Equipe'}</p>
          </div>
          <div>
            <ThemeToggle />
            <div className="btn-group me-2">
              <button className={`btn btn-sm btn-outline-secondary ${view === 'individual' && 'active'}`} onClick={() => setView('individual')}>Minhas Tarefas</button>
              <button className={`btn btn-sm btn-outline-secondary ${view === 'team' && 'active'}`} onClick={() => setView('team')}>Equipe</button>
            </div>
            <div className="btn-group me-2">
              <button className={`btn btn-sm btn-outline-secondary ${ganttViewMode === 'Day' && 'active'}`} onClick={() => changeGanttViewMode('Day')}>Dia</button>
              <button className={`btn btn-sm btn-outline-secondary ${ganttViewMode === 'Week' && 'active'}`} onClick={() => changeGanttViewMode('Week')}>Semana</button>
              <button className={`btn btn-sm btn-outline-secondary ${ganttViewMode === 'Month' && 'active'}`} onClick={() => changeGanttViewMode('Month')}>Mês</button>
            </div>
            <button className="btn btn-primary me-2" onClick={openModalToCreate}>+ Adicionar Tarefa</button>
            <button className="btn btn-light" onClick={onLogout}>Sair</button>
          </div>
        </div>
        
        <div className="card shadow-sm mb-4">
          <div className="card-body gantt-card-body">
            {tasksToDisplay.length > 0 ? (
              <div className="gantt-container" ref={ganttRef} key={tasks.length}></div>
            ) : (
              <div className="empty-state">
                <h5 className="text-muted">Nenhuma tarefa ainda.</h5>
                <p className="text-muted">Que tal adicionar uma para começar?</p>
                <button className="btn btn-primary mt-2" onClick={openModalToCreate}>Criar Primeira Tarefa</button>
              </div>
            )}
          </div>
        </div>

        {listTasks.length > 0 && (
            <div className="card shadow-sm">
                <div className="card-header"><h5 className="card-title mb-0">Lista de Tarefas ({view === 'individual' ? 'Minhas Tarefas' : 'Equipe'})</h5></div>
                <div className="table-responsive">
                    <table className="table table-hover table-striped table-nowrap mb-0">
                        <thead><tr>{view === 'team' && <th>Dono</th>}<th>Nome da Tarefa</th><th>Data de Início</th><th>Data de Término</th><th>Ações</th></tr></thead>
                        <tbody>
                            {listTasks.map(task => (
                                <tr key={task.id}>
                                    {view === 'team' && <td>{task.owner}</td>}
                                    <td><span className="d-inline-block me-2" style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: task.color }}></span>{task.name}</td>
                                    <td>{formatDate(task.start)}</td>
                                    <td>{formatDate(task.end)}</td>
                                    <td>
                                      {task.owner === currentUser ? (
                                        <>
                                          <button className="btn btn-sm btn-light me-2" onClick={() => openModalToEdit(task)}>Editar</button>
                                          <button className="btn btn-sm btn-light text-danger" onClick={() => handleDelete(task.id)}>Excluir</button>
                                        </>
                                      ) : (
                                        <small className="text-muted">Somente leitura</small>
                                      )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        )}
      </div>

      {isModalOpen && (
        <div className="modal" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <form onSubmit={handleFormSubmit}>
                <div className="modal-header"><h5 className="modal-title">{editingTask && editingTask.id ? 'Editar Tarefa' : 'Adicionar Tarefa'}</h5><button type="button" className="btn-close" onClick={closeModal}></button></div>
                <div className="modal-body">
                  <div className="mb-3"><label htmlFor="name" className="form-label">Nome</label><input ref={nameInputRef} type="text" className="form-control" id="name" name="name" value={editingTask?.name || ''} onChange={handleInputChange} required /></div>
                  <div className="mb-3"><label htmlFor="start" className="form-label">Início</label><input type="date" className="form-control" id="start" name="start" value={editingTask?.start || ''} onChange={handleInputChange} required /></div>
                  <div className="mb-3"><label htmlFor="end" className="form-label">Término</label><input type="date" className="form-control" id="end" name="end" value={editingTask?.end || ''} onChange={handleInputChange} required /></div>
                  <div className="mb-3"><label htmlFor="color" className="form-label">Cor</label><input type="color" className="form-control form-control-color" id="color" name="color" value={editingTask?.color || '#0288d1'} onChange={handleInputChange} /></div>
                </div>
                <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={closeModal}>Fechar</button><button type="submit" className="btn btn-primary">Salvar</button></div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// --- Theme Toggle Component --- //
const ThemeToggle = () => {
  const { toggleTheme, isDark } = useTheme();

  return (
    <button 
      className="btn btn-outline-secondary btn-sm me-2" 
      onClick={toggleTheme}
      title={`Alternar para modo ${isDark ? 'claro' : 'escuro'}`}
    >
      {isDark ? '☀️' : '🌙'}
    </button>
  );
};

// --- App Component with Login Logic --- //
const App = () => {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const response = await fetch(`${API_URL}/users`);
        if (!response.ok) throw new Error('Failed to fetch users.');
        const data = await response.json();
        setUsers(data);
      } catch (err) {
        setError('Não foi possível carregar a lista de usuários. O servidor backend está rodando?');
        console.error(err);
      }
    };
    fetchUsers();
  }, []);

  const handleLogin = (user) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    setCurrentUser(null);
  };

  if (!currentUser) {
    return <LoginScreen users={users} onLogin={handleLogin} error={error} />;
  }

  return <GanttApp currentUser={currentUser} onLogout={handleLogout} />;
};

// --- Main App with Theme Provider --- //
const AppWithTheme = () => {
  return (
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
};

export default AppWithTheme;
