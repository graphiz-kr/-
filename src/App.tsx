import React, { useState, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  TrendingUp, 
  Target, 
  AlertCircle, 
  CheckCircle2, 
  Loader2, 
  Send,
  BarChart3,
  ShieldCheck,
  Printer,
  Briefcase,
  RefreshCw,
  ChevronRight,
  BarChart
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  BarChart as ReBarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Project Types
type ProjectType = 'PRELIMINARY' | 'INITIAL' | 'LEAP' | 'HOPE_RETURN_MGMT' | 'HOPE_RETURN_RE';

interface ProjectConfig {
  id: ProjectType;
  label: string;
  description: string;
  icon: React.ElementType;
}

const PROJECT_CONFIGS: ProjectConfig[] = [
  { 
    id: 'PRELIMINARY', 
    label: '예비창업패키지', 
    description: '아이디어 단계의 예비창업자 대상 (PSST 구조)', 
    icon: Target 
  },
  { 
    id: 'INITIAL', 
    label: '초기창업패키지', 
    description: '창업 3년 이내 초기 기업 대상 (성장 지표 중심)', 
    icon: TrendingUp 
  },
  { 
    id: 'LEAP', 
    label: '창업도약패키지', 
    description: '창업 3~7년 이내 도약기 기업 (성과 및 스케일업)', 
    icon: BarChart3 
  },
  { 
    id: 'HOPE_RETURN_MGMT', 
    label: '희망리턴(경영개선)', 
    description: '소상공인 경영 위기 극복 및 개선 지원', 
    icon: RefreshCw 
  },
  { 
    id: 'HOPE_RETURN_RE', 
    label: '희망리턴(재창업)', 
    description: '폐업 후 재기를 꿈꾸는 재창업자 대상', 
    icon: Briefcase 
  },
];

interface ChartData {
  title: string;
  type: 'bar' | 'line' | 'pie';
  data: any[];
  source: string;
}

interface ImageAsset {
  section: string;
  url: string;
  prompt: string;
}

interface AnalysisResult {
  report: string;
  charts: ChartData[];
  imagePrompts: { section: string; prompt: string }[];
  projectId: ProjectType;
}

export default function App() {
  const [inputs, setInputs] = useState({
    email: '',
    general: '',
    item: '',
    market: '',
    plan: ''
  });
  const [selectedProject, setSelectedProject] = useState<ProjectType | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [generatedImages, setGeneratedImages] = useState<ImageAsset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isIframe, setIsIframe] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  const [isDriveConnected, setIsDriveConnected] = useState(false);

  React.useEffect(() => {
    setIsIframe(window.self !== window.top);
    checkDriveStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GOOGLE_AUTH_SUCCESS') {
        setIsDriveConnected(true);
        checkDriveStatus();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const checkDriveStatus = async () => {
    try {
      const res = await fetch('/api/auth/google/status');
      const data = await res.json();
      setIsDriveConnected(data.isAuthenticated);
    } catch (err) {
      console.error("Failed to check Drive status:", err);
    }
  };

  const handleConnectDrive = async () => {
    try {
      const res = await fetch('/api/auth/google/url');
      const { url } = await res.json();
      window.open(url, 'google_auth', 'width=600,height=700');
    } catch (err) {
      console.error("Failed to get auth URL:", err);
    }
  };

  const withRetry = async <T extends unknown>(fn: () => Promise<T>, maxRetries = 3, initialDelay = 2000): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        const isRateLimit = 
          err.message?.includes("429") || 
          err.status === 429 || 
          err.code === 429 || 
          err.error?.code === 429 ||
          err.message?.includes("RESOURCE_EXHAUSTED");
        if (isRateLimit && i < maxRetries - 1) {
          const delay = initialDelay * Math.pow(2, i);
          console.log(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };

  const handleAnalyze = async () => {
    if (!agreedToPrivacy) {
      setError("개인정보 수집 및 이용에 동의해주세요.");
      return;
    }

    if (!inputs.email || !inputs.email.includes('@')) {
      setError("올바른 이메일 주소를 입력해주세요. 전략 리포트 생성을 위해 반드시 필요합니다.");
      return;
    }

    const isAnyInputEmpty = Object.values(inputs).some(val => !val.trim());
    if (isAnyInputEmpty) {
      setError("모든 전략 섹션을 입력해주세요.");
      return;
    }
    
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setGeneratedImages([]);

    try {
      // Save email to Google Drive in background
      fetch('/api/save-email-to-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inputs.email, timestamp: new Date().toISOString() })
      }).catch(err => console.error("Failed to save email to Drive:", err));

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3.1-pro-preview";
      
      const availableProjects = PROJECT_CONFIGS.map(p => `${p.id}: ${p.label} (${p.description})`).join('\n');

      const prompt = `
        # 페르소나
        귀하는 대한민국 중소벤처기업부 및 유관기관의 지원사업 심사 기준을 완벽히 숙지한 '공공기관 대외협력 및 창업 지원 전략 수석 컨설턴트'입니다.

        # 핵심 참조 지침 (Reference Protocol)
        1. 내부 표준 모델: 정부지원사업의 '표준 합격 모델(우수 사례)'의 논리 전개 방식과 기술적 상세 수준을 모든 문서 작성의 절대적 벤치마킹 표준으로 삼습니다. (단, 출력 시 '누룩집' 등 내부 명칭 사용을 금하며, "정부지원사업 표준 합격 가이드"를 따름을 명시하십시오.)
        2. 공식 양식 준수: 예비창업패키지, 초기창업패키지, 창업도약패키지, 희망리턴패키지의 최신 공고 양식과 항목별 작성 지침을 100% 반영합니다.

        # 사용자 입력 정보 (4대 전략 섹션)
        I. 신청 자격 및 기업 일반 현황: ${inputs.general}
        II. 창업 아이템의 개요 및 특성: ${inputs.item}
        III. 시장성 및 차별화 전략: ${inputs.market}
        IV. 사업화 추진 및 자금 운용 계획: ${inputs.plan}

        # 지원 가능 사업 목록
        ${availableProjects}

        # 워크플로우 (Workflow)
        [단계 1: 전략적 사업 매칭]
        사용자가 입력한 정보를 정밀 분석하여, 위 목록 중 가장 적정성이 높은 사업(projectId)을 하나 선택하십시오. 
        보고서 서두에 해당 사업을 선정한 구체적인 법적/행정적 근거(업력, 매출, 아이템 특성 등)를 전문가적 관점에서 상세히 기술하십시오.

        [단계 2: 표준 합격 모델 기반 전문 보고서 작성]
        매칭된 사업의 공식 목차에 의거하여 처음부터 끝까지 모든 세부 내용을 AI가 직접 작성하십시오. 
        - 사용자가 입력한 요약 정보를 바탕으로, 전문 컨설턴트가 작성한 수준의 방대하고 구체적인 텍스트를 생성하십시오.
        - 각 섹션은 최소 500자 이상의 상세한 설명과 논리적 근거를 포함해야 합니다.
        - 문제인식: 거시적/미시적 시장 통계 및 객관적 지표를 근거로 개발의 시급성 강조. 
        - 실현가능성: 기술적 구현 로드맵과 독창성을 '우수 사례 가이드' 수준으로 상세화. 
        - 성장전략: 비즈니스 모델(BM)의 수익 구조와 글로벌 시장 진입 가능성 제시. 

        [단계 3: 데이터 기반 고도화]
        - 모든 내용은 수정이 필요 없는 '최종본' 수준으로 작성하십시오.
        - 전문 용어와 행정 용어를 적절히 섞어 신뢰도를 극대화하십시오.

        # 출력 지침 (Style Guide - 필수 준수)
        1. 페이지 잘림 방지 (Block Integrity):
           - 동일한 주제의 내용(예: 'III. 성장전략' 전체)은 가급적 한 페이지에 배치하십시오.
           - 내용이 길어 다음 페이지로 넘어가야 한다면, 문장 중간이 아니라 소제목 단위에서 페이지를 넘기도록 구성하십시오.
           - 특히 [표]나 [그래프]는 절반으로 잘리지 않도록 반드시 한 페이지 안에 온전히 포함시키십시오.
        2. 여백 및 레이아웃 설정 (Fixed Margin):
           - 모든 페이지의 상·하·좌·우 여백을 10mm로 고정하여 시각적 안정감을 주십시오.
           - 텍스트가 페이지 끝에 너무 붙지 않도록 문단 끝에 적절한 여백을 자동 계산하여 배치하십시오.
        3. 클린 텍스트 출력 (No HTML/Source Tags):
           - 출력물에서 <br>, <div>, \`\`\` 과 같은 모든 HTML 태그 및 데이터 추출 태그를 완전히 제거하십시오.
           - 줄바꿈이 필요한 경우 태그 대신 마크다운의 '엔터(Line break)' 두 번을 사용하여 자연스럽게 공백을 형성하십시오.
        4. 그래프 가독성 고도화:
           - 그래프 내 텍스트 겹침을 방지하기 위해 제목은 간결하게 작성하십시오.
           - 단위(%) 및 출처 정보는 그래프 제목 옆이 아닌, 그래프 하단에 작은 글씨로 별도 분리하여 배치하십시오.
        5. 계층별 글자 크기 및 스타일:
           - 단계 제목 (Level 1): ## [단계 n: 제목] 형식을 사용하고, 가장 크고 굵게 표시하십시오.
           - 상세 제목 (Level 2): ### I. 항목 제목 형식을 사용하고, 중간 크기로 표시하십시오.
           - 본문 및 수치: 일반 크기(Normal)로 작성하십시오.
           - 캡션 및 출처: 가장 작은 크기(Small/Caption)로 작성하십시오.
        6. 페이지 및 문단 나누기:
           - 각 [단계]가 바뀔 때마다 반드시 가로 구분선(---)을 삽입하여 페이지 분할 효과를 주십시오.
           - 문단과 문단 사이에는 반드시 빈 줄 하나를 삽입하여 가독성을 확보하십시오.
        7. 표(Table) 구성:
           - 자금 계획이나 수치가 포함된 내용은 반드시 마크다운 표 형식을 사용하고 좌우 정렬을 맞추십시오.
           - 표 상단에는 해당 표의 제목을 **표 제목** 형식으로 굵게 표시하십시오.
        8. 데이터 정제:
           - 이미지 생성용 영문 프롬프트 텍스트는 리포트 본문에서 절대 제외하십시오.

        # 시각화 배치 지침
        - 보고서 본문 마크다운 내에 시각 자료가 들어갈 적절한 위치에 [CHART_0], [CHART_1], [IMAGE_0], [IMAGE_1] 등의 플레이스홀더를 삽입하십시오.
        - 모든 차트 데이터는 실제 수치(Number)를 포함한 JSON 배열로 작성하십시오.
        - 출처 표기: 모든 데이터에 대해 구체적인 출처를 명시하십시오.

        [응답 JSON 구조]:
        {
          "projectId": "선택된 사업의 ID (예: PRELIMINARY, INITIAL, LEAP 등)",
          "report": "마크다운 형식의 리포트 (플레이스홀더 포함)",
          "charts": [
            {
              "title": "시장 규모 전망",
              "type": "line",
              "data": [
                { "name": "2024", "value": 1200 },
                { "name": "2025", "value": 1500 },
                { "name": "2026", "value": 1900 },
                { "name": "2027", "value": 2400 },
                { "name": "2028", "value": 3100 }
              ],
              "source": "출처 정보 (예: 2026 Gartner IT Spending Forecast)"
            }
          ],
          "imagePrompts": [
            { "section": "Solution", "prompt": "..." }
          ]
        }
      `;

      const response = await withRetry(() => ai.models.generateContent({
        model: model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          tools: [{ googleSearch: {} }]
        }
      }));

      const data = JSON.parse(response.text || "{}") as AnalysisResult;
      
      // Sanitize data to ensure all required fields exist
      const sanitizedData: AnalysisResult = {
        projectId: data.projectId || selectedProject || 'PRELIMINARY',
        report: data.report || "",
        charts: Array.isArray(data.charts) ? data.charts : [],
        imagePrompts: Array.isArray(data.imagePrompts) ? data.imagePrompts : []
      };

      setResult(sanitizedData);
      setSelectedProject(sanitizedData.projectId);

      // --- New: Save to Sheets and Notify Admin ---
      const projectLabel = PROJECT_CONFIGS.find(p => p.id === sanitizedData.projectId)?.label || "사업계획서";
      const today = new Date().toISOString().split('T')[0];
      const dynamicTitle = `${projectLabel}_${today}_${inputs.email}`;

      // [A] 구글 드라이브 & 시트 자동 저장 (입력 내용 포함)
      const GAS_URL = "https://script.google.com/macros/s/AKfycbxiH_laWtcf8dSZny_ykz9OtwVHMMlOHVqBFPTPJs7ksQ3i7-Nqaiw0RtfwrFcfSR8OIg/exec"; 
      fetch(GAS_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: inputs.email,
          question: projectLabel,
          businessPlan: sanitizedData.report,
          // 사용자가 입력한 4대 전략 섹션 추가
          userInput_general: inputs.general,
          userInput_item: inputs.item,
          userInput_market: inputs.market,
          userInput_plan: inputs.plan
        })
      }).catch(err => console.error("Failed to save to GAS:", err));

      // [B] 관리자 알림 발송 (graphiz@graphiz.kr로 전송됨)
      fetch('/api/request-download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inputs.email,
          title: dynamicTitle,
          content: sanitizedData.report,
          userInputs: inputs
        })
      }).catch(err => console.error("Failed to notify admin:", err));

      // [C] 작성자 본인에게 이메일 발송
      fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: inputs.email,
          title: dynamicTitle,
          content: sanitizedData.report
        })
      }).catch(err => console.error("Failed to send email to user:", err));

      alert("분석이 완료되었습니다. 메일 발송이 시작되었습니다.");
      // ------------------------------------------

      // Generate Images in background
      if (sanitizedData.imagePrompts.length > 0) {
        generateBusinessImages(sanitizedData.imagePrompts);
      }

    } catch (err: any) {
      console.error(err);
      if (err.message?.includes("429") || err.status === 429) {
        setError("API 할당량을 초과했습니다. 잠시 후 다시 시도해주세요. (Rate Limit Exceeded)");
      } else {
        setError("계획서 생성 중 오류가 발생했습니다. 다시 시도해주세요.");
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const generateBusinessImages = async (prompts: { section: string; prompt: string }[]) => {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    for (const item of prompts) {
      try {
        // Add a small delay between image requests to avoid hitting rate limits
        await new Promise(resolve => setTimeout(resolve, 1000));

        const response = await withRetry(() => ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: { parts: [{ text: item.prompt }] },
          config: { imageConfig: { aspectRatio: "16:9" } }
        }), 2, 3000);

        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const imageUrl = `data:image/png;base64,${part.inlineData.data}`;
            setGeneratedImages(prev => [...prev, { section: item.section, url: imageUrl, prompt: item.prompt }]);
          }
        }
      } catch (err) {
        console.error("Image generation failed for:", item.section, err);
      }
    }
  };

  const handleReset = () => {
    setInputs({
      email: '',
      general: '',
      item: '',
      market: '',
      plan: ''
    });
    setResult(null);
    setSelectedProject(null);
    setGeneratedImages([]);
    setError(null);
    setAgreedToPrivacy(false);
  };

  const handlePrint = () => {
    const content = reportRef.current?.innerHTML;
    if (!content) return;

    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(`
        <html>
          <head>
            <title>사업계획서 인쇄</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              @page { size: A4; margin: 20mm; }
              body { padding: 0; font-family: sans-serif; line-height: 1.6; }
              
              /* 이미지와 차트가 겹치지 않게 강제 설정 */
              img, .recharts-responsive-container { 
                max-width: 100% !important; 
                height: auto !important; 
                display: block;
                margin: 20px 0 !important; /* 위아래 간격 확보 */
              }
              
              /* 페이지 끝에서 이미지가 잘리거나 겹치는 것 방지 */
              .my-8 { 
                page-break-inside: avoid; 
                break-inside: avoid; 
                display: block;
                clear: both;
                margin: 40px 0 !important;
              }

              h1 { 
                font-size: 2.5rem !important; 
                font-weight: 900 !important; 
                margin-bottom: 1.5rem !important;
                color: #1e1b4b !important;
              }

            @page {
              size: A4;
              margin: 10mm;
            }

            body {
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }

            .print-container {
              padding: 10mm !important;
              background: white !important;
            }

            h2, h3, h4 {
              page-break-after: avoid;
            }

            table, .recharts-wrapper, img, .chart-container {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            h2 { 
              page-break-before: always; 
              font-size: 2.2rem !important; 
              font-weight: 900 !important; 
              margin-top: 2rem !important; 
              margin-bottom: 2rem !important;
              border-bottom: 4px solid #1e1b4b;
              padding-bottom: 1rem;
              color: #1e1b4b !important;
            }

            h2:first-of-type {
              page-break-before: auto;
              margin-top: 0 !important;
            }

            h3 { 
              font-size: 1.8rem !important; 
              font-weight: 800 !important; 
              margin-top: 3rem !important;
              margin-bottom: 1.5rem !important;
              color: #312e81 !important;
            }

            h4 {
              font-size: 1.4rem !important;
              font-weight: 700 !important;
              margin-top: 2rem !important;
              margin-bottom: 1rem !important;
              color: #4338ca !important;
            }

            p { 
              margin-bottom: 1.5rem !important; 
              font-size: 1.1rem !important;
              line-height: 1.8 !important;
            }

            li {
              margin-bottom: 0.8rem !important;
            }
            
            .prose { max-width: 100% !important; }
            .prose table { width: 100% !important; table-layout: fixed !important; }
            .prose th, .prose td { word-break: keep-all !important; }
            </style>
          </head>
          <body>
            <div class="prose">
              ${content}
            </div>
            <script>
              // 이미지와 차트가 모두 로드될 때까지 2초 대기
              window.onload = () => {
                setTimeout(() => {
                  window.print();
                  // window.close(); // 확인 후 주석 해제하세요
                }, 2000);
              };
            </script>
          </body>
        </html>
      `);
      printWindow.document.close();
    }
  };
  // -----------------------
  const COLORS = ['#6366f1', '#a855f7', '#ec4899', '#3B82F6', '#F59E0B'];

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-[#111827] font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 px-6 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center overflow-hidden">
              <img 
                src="https://lh3.googleusercontent.com/d/1VilZqsiVFpS38S-wyzfu91QHJTs9c5Fl" 
                alt="Logo" 
                className="w-full h-full object-contain"
              />
            </div>
            <div>
              <h1 className="text-lg font-extrabold tracking-tight text-indigo-900">GRAPHiz MATCH</h1>
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.2em]">Public Sector Startup Expert v8.0</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handleConnectDrive}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] font-bold transition-all",
                isDriveConnected 
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100" 
                  : "bg-indigo-50 text-indigo-700 border border-indigo-100 hover:bg-indigo-100"
              )}
            >
              <ShieldCheck className={cn("w-3 h-3", isDriveConnected ? "text-emerald-500" : "text-indigo-500")} />
              {isDriveConnected ? "Google Drive Connected" : "Connect Google Drive"}
            </button>
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-indigo-50 border border-indigo-100 rounded-full">
              <div className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-indigo-700">Visual Data & AI Image Enabled</span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-4 space-y-6">
          <section className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Target className="w-5 h-5 text-indigo-700" />
                <h2 className="font-extrabold text-base">4대 전략 섹션 입력</h2>
              </div>
              <button 
                onClick={handleReset}
                className="text-[10px] font-bold text-gray-400 hover:text-indigo-600 flex items-center gap-1 transition-colors"
              >
                <RefreshCw className="w-3 h-3" />
                초기화
              </button>
            </div>
            
            <p className="text-xs text-gray-500 font-medium leading-relaxed">
              아래 정보를 입력하시면 AI 컨설턴트가 가장 적합한 정부지원사업을 자동으로 매칭하여 최적화된 보고서를 작성합니다.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-black text-indigo-900 mb-1 uppercase tracking-tighter">작성자 이메일 (필수)</label>
                <p className="text-[10px] text-gray-400 font-bold mb-2">리포트 생성 및 데이터 저장을 위해 필요합니다.</p>
                <input
                  type="email"
                  value={inputs.email}
                  onChange={(e) => setInputs(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="example@email.com"
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all"
                />
              </div>

              <div>
                <label className="block text-xs font-black text-indigo-900 mb-1 uppercase tracking-tighter">I. 신청 자격 및 기업 일반 현황</label>
                <p className="text-[10px] text-gray-400 font-bold mb-2">가이드: 업력(설립일), 소재지, 대표자 주요 이력, 폐업 및 재기 여부 등</p>
                <div className="relative">
                  <textarea
                    value={inputs.general}
                    onChange={(e) => setInputs(prev => ({ ...prev, general: e.target.value.slice(0, 1000) }))}
                    maxLength={1000}
                    className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all"
                  />
                  <span className="absolute bottom-2 right-3 text-[10px] font-bold text-gray-300">
                    {inputs.general.length}/1000
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-indigo-900 mb-1 uppercase tracking-tighter">II. 창업 아이템의 개요 및 특성</label>
                <p className="text-[10px] text-gray-400 font-bold mb-2">가이드: 아이템 명칭, 핵심 기술 요약, 개발 동기 등</p>
                <div className="relative">
                  <textarea
                    value={inputs.item}
                    onChange={(e) => setInputs(prev => ({ ...prev, item: e.target.value.slice(0, 1000) }))}
                    maxLength={1000}
                    className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all"
                  />
                  <span className="absolute bottom-2 right-3 text-[10px] font-bold text-gray-300">
                    {inputs.item.length}/1000
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-indigo-900 mb-1 uppercase tracking-tighter">III. 시장성 및 차별화 전략</label>
                <p className="text-[10px] text-gray-400 font-bold mb-2">가이드: 주 타겟 고객층, 기존 솔루션 대비 우위 요소, 경쟁사 현황 등</p>
                <div className="relative">
                  <textarea
                    value={inputs.market}
                    onChange={(e) => setInputs(prev => ({ ...prev, market: e.target.value.slice(0, 1000) }))}
                    maxLength={1000}
                    className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all"
                  />
                  <span className="absolute bottom-2 right-3 text-[10px] font-bold text-gray-300">
                    {inputs.market.length}/1000
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-black text-indigo-900 mb-1 uppercase tracking-tighter">IV. 사업화 추진 및 자금 운용 계획</label>
                <p className="text-[10px] text-gray-400 font-bold mb-2">가이드: 핵심 추진 로드맵, 정부지원금 활용 희망 분야(시제품, 마케팅 등)</p>
                <div className="relative">
                  <textarea
                    value={inputs.plan}
                    onChange={(e) => setInputs(prev => ({ ...prev, plan: e.target.value.slice(0, 1000) }))}
                    maxLength={1000}
                    className="w-full h-24 p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none font-medium transition-all"
                  />
                  <span className="absolute bottom-2 right-3 text-[10px] font-bold text-gray-300">
                    {inputs.plan.length}/1000
                  </span>
                </div>
              </div>
            </div>

            {/* Privacy Agreement & AI Notice */}
            <div className="mt-6 space-y-4">
              <div className="flex items-start gap-3 p-3 bg-indigo-50/50 border border-indigo-100 rounded-xl">
                <input 
                  type="checkbox" 
                  id="privacy-agree"
                  checked={agreedToPrivacy}
                  onChange={(e) => setAgreedToPrivacy(e.target.checked)}
                  className="mt-1 w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500 cursor-pointer"
                />
                <label htmlFor="privacy-agree" className="text-[11px] text-gray-600 font-medium leading-relaxed cursor-pointer">
                  <span className="text-indigo-900 font-bold">[필수] 개인정보 수집 및 이용 동의</span>
                  <br />
                  입력하신 정보는 AI 분석 및 보고서 생성을 위해서만 사용되며, 분석 완료 후 별도로 저장되지 않습니다.
                </label>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse" />
                <p className="text-[10px] text-slate-500 font-bold">
                  본 사업계획서는 인공지능(AI) 기술을 통해 생성된 초안입니다. 최종 제출 전 반드시 전문가의 검토를 권장합니다.
                </p>
              </div>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !agreedToPrivacy}
              className={cn(
                "w-full mt-4 py-4 rounded-xl font-black text-sm flex items-center justify-center gap-2 transition-all shadow-lg",
                isAnalyzing || !agreedToPrivacy
                  ? "bg-gray-200 text-gray-400 cursor-not-allowed shadow-none" 
                  : "bg-indigo-700 text-white hover:bg-indigo-800 active:scale-[0.98] shadow-indigo-200"
              )}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  전략 리포트 생성 중...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  전략 리포트 생성 시작
                </>
              )}
            </button>
          </section>
        </div>

        {/* Right Column: Results */}
        <div className="lg:col-span-8">
          <AnimatePresence mode="wait">
            {!result && !isAnalyzing && !error && (
              <motion.div 
                key="empty"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="h-full min-h-[600px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-3xl border border-dashed border-gray-300"
              >
                <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mb-8">
                  <BarChart3 className="w-12 h-12 text-gray-300" />
                </div>
                <h2 className="text-2xl font-black text-gray-800 mb-3">사업계획서 작성 대기 중</h2>
                <p className="text-gray-500 max-w-md font-medium">
                  정보를 입력하면 전문 그래프와 AI 생성 이미지가 포함된 <br />
                  합격 수준의 사업계획서가 도출됩니다.
                </p>
              </motion.div>
            )}

            {isAnalyzing && (
              <motion.div 
                key="analyzing"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="h-full min-h-[600px] flex flex-col items-center justify-center text-center p-12 bg-white rounded-3xl border border-gray-200 shadow-sm"
              >
                <div className="relative mb-10">
                  <div className="w-32 h-32 border-8 border-indigo-50 border-t-indigo-700 rounded-full animate-spin" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <BarChart className="w-10 h-10 text-indigo-700 animate-pulse" />
                  </div>
                </div>
                <h2 className="text-2xl font-black text-indigo-900 mb-4">수석 컨설턴트 전략 분석 중</h2>
                <div className="space-y-3 text-gray-500 text-sm font-bold">
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-indigo-500" />
                    <p>I. 일반 현황 기반 최적 사업 매칭 중</p>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    <p>표준 합격 모델 기반 고밀도 초안 도출 중...</p>
                  </div>
                  <div className="flex items-center justify-center gap-2 opacity-50">
                    <ChevronRight className="w-4 h-4" />
                    <p>인터랙티브 편집 및 고도화 가이드 생성 중</p>
                  </div>
                </div>
              </motion.div>
            )}

            {error && (
              <motion.div 
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="p-8 bg-red-50 border border-red-100 rounded-3xl text-red-700 flex flex-col items-center gap-4"
              >
                <AlertCircle className="w-12 h-12" />
                <div className="text-center">
                  <p className="text-lg font-black">{error}</p>
                  {isIframe && (
                    <button 
                      onClick={() => window.open(window.location.href, '_blank')}
                      className="mt-4 px-6 py-2 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2 mx-auto"
                    >
                      새 탭에서 앱 열기 <ChevronRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {!isIframe && (
                  <button onClick={handleAnalyze} className="px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-colors">
                    다시 시도
                  </button>
                )}
              </motion.div>
            )}

            {result && (
              <motion.div 
                key="result"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="space-y-8"
              >
                {/* AI Matching Result Banner */}
                <div className="bg-white rounded-2xl border-2 border-indigo-600 p-6 shadow-lg shadow-indigo-100 flex items-center gap-6 relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-black px-4 py-1 rounded-bl-xl uppercase tracking-widest">
                    AI Matching Success
                  </div>
                  <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center text-indigo-700 shrink-0">
                    {(() => {
                      const Icon = PROJECT_CONFIGS.find(p => p.id === selectedProject)?.icon || ShieldCheck;
                      return <Icon className="w-8 h-8" />;
                    })()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-black text-indigo-600 uppercase tracking-tighter bg-indigo-50 px-2 py-0.5 rounded">최적 매칭 사업</span>
                      <h3 className="text-xl font-black text-indigo-900">
                        {PROJECT_CONFIGS.find(p => p.id === selectedProject)?.label}
                      </h3>
                    </div>
                    <p className="text-sm text-gray-600 font-medium">
                      {PROJECT_CONFIGS.find(p => p.id === selectedProject)?.description}
                    </p>
                  </div>
                </div>

                {/* Main Report with Embedded Assets */}
                <div ref={reportRef} className="bg-white rounded-3xl border border-gray-200 shadow-xl overflow-hidden min-h-[800px]">
                  <div className="bg-indigo-900 px-8 py-6 flex justify-between items-center text-white print:hidden">
                    <div>
                      <h3 className="text-xl font-black tracking-tight">
                        {PROJECT_CONFIGS.find(p => p.id === selectedProject)?.label || "매칭된 지원사업 리포트"}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs font-bold text-indigo-300 uppercase tracking-widest">Full Strategy Report with Visual Assets</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={handlePrint} // 우리가 새로 만든 함수 이름을 넣습니다.
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/15 rounded-xl text-sm font-black transition-all backdrop-blur-sm border border-white/10"
                        title="브라우저 인쇄 기능을 사용하여 PDF로 저장"
                      >
                        <Printer className="w-4 h-4" />
                        인쇄
                      </button>
                    </div>
                  </div>
                  
                  <div className="p-10">
                    <div className="prose prose-slate max-w-none 
                      prose-headings:text-indigo-900 prose-headings:font-black prose-headings:tracking-tight
                      prose-h2:text-4xl prose-h2:mt-24 prose-h2:mb-12 prose-h2:pb-4 prose-h2:border-b-4 prose-h2:border-indigo-900
                      prose-h3:text-3xl prose-h3:mt-20 prose-h3:mb-8 prose-h3:text-indigo-800
                      prose-h4:text-2xl prose-h4:mt-12 prose-h4:mb-6 prose-h4:text-indigo-700
                      prose-p:text-gray-700 prose-p:leading-relaxed prose-p:font-medium prose-p:mb-8 prose-p:text-lg
                      prose-strong:text-indigo-900 prose-strong:font-black
                      prose-table:border-2 prose-table:border-gray-200 prose-table:rounded-xl prose-table:overflow-hidden prose-table:my-12
                      prose-th:bg-indigo-50 prose-th:text-indigo-900 prose-th:p-6 prose-th:border-b-2 prose-th:border-indigo-100
                      prose-td:p-6 prose-td:border-b prose-td:border-gray-50
                      prose-ul:list-disc prose-ul:pl-8 prose-ul:my-8
                      prose-li:mb-4 prose-li:text-lg
                    ">
                      {(() => {
                        if (!result?.report) return null;
                        const parts = result.report.split(/(\[CHART_\d+\]|\[IMAGE_\d+\])/g);
                        return parts.map((part, index) => {
                          const chartMatch = part.match(/\[CHART_(\d+)\]/);
                          const imageMatch = part.match(/\[IMAGE_(\d+)\]/);

                          if (chartMatch) {
                            const chartIdx = parseInt(chartMatch[1]);
                            const chart = result.charts[chartIdx];
                            if (!chart || !Array.isArray(chart.data) || chart.data.length === 0) return null;

                            const formatValue = (val: number) => {
                              if (val >= 1000000) return `${(val / 1000000).toFixed(1)}M`;
                              if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
                              return val.toString();
                            };

                            return (
                              <div key={index} className="my-8 bg-gray-50 p-6 rounded-2xl border border-gray-200 not-prose">
                                <h3 className="text-sm font-black text-gray-800 mb-4 flex items-center justify-between">
                                  <span className="flex items-center gap-2">
                                    <BarChart3 className="w-4 h-4 text-indigo-600" />
                                    {chart.title}
                                  </span>
                                  <span className="text-[10px] text-gray-400 font-bold uppercase">Source: {chart.source}</span>
                                </h3>
                                <div className="w-full">
                                  <ResponsiveContainer width="100%" aspect={2}>
                                    {chart.type === 'bar' ? (
                                      <ReBarChart data={chart.data}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700}} />
                                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700}} tickFormatter={formatValue} />
                                        <Tooltip 
                                          cursor={{fill: '#F3F4F6'}} 
                                          contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}}
                                          formatter={(value: number) => [formatValue(value), 'Value']}
                                        />
                                        <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                                      </ReBarChart>
                                    ) : chart.type === 'line' ? (
                                      <LineChart data={chart.data}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700}} />
                                        <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fontWeight: 700}} tickFormatter={formatValue} />
                                        <Tooltip 
                                          contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}}
                                          formatter={(value: number) => [formatValue(value), 'Value']}
                                        />
                                        <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} dot={{r: 4, fill: '#6366f1'}} isAnimationActive={false} />
                                      </LineChart>
                                    ) : (
                                      <PieChart>
                                        <Pie data={chart.data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={(entry) => `${entry.name}: ${formatValue(entry.value)}`} isAnimationActive={false}>
                                          {chart.data.map((entry: any, entryIdx: number) => (
                                            <Cell key={`cell-${chartIdx}-${entryIdx}`} fill={COLORS[entryIdx % COLORS.length]} />
                                          ))}
                                        </Pie>
                                        <Tooltip formatter={(value: number) => [formatValue(value), 'Value']} />
                                      </PieChart>
                                    )}
                                  </ResponsiveContainer>
                                </div>
                              </div>
                            );
                          }

                          if (imageMatch) {
                            const imageIdx = parseInt(imageMatch[1]);
                            const img = generatedImages[imageIdx];
                            if (!img) {
                              return (
                                <div key={index} className="my-8 p-12 bg-indigo-50 border border-indigo-100 rounded-2xl flex flex-col items-center justify-center text-center not-prose">
                                  <Loader2 className="w-8 h-8 text-indigo-600 animate-spin mb-4" />
                                  <p className="text-sm font-bold text-indigo-800">합격권 비즈니스 비주얼 생성 중...</p>
                                </div>
                              );
                            }
                            return (
                              <div key={index} className="my-8 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden group not-prose">
                                <div className="relative aspect-video">
                                  <img src={img.url} alt={img.section} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  <div className="absolute top-3 left-3 bg-indigo-900/80 backdrop-blur-sm text-white text-[10px] font-black px-2 py-1 rounded-lg uppercase tracking-widest">
                                    AI Visual: {img.section}
                                  </div>
                                </div>
                                <div className="p-4 bg-gray-50">
                                  <p className="text-[10px] text-gray-500 font-bold leading-tight italic">"{img.prompt}"</p>
                                </div>
                              </div>
                            );
                          }

                          return <ReactMarkdown key={index} remarkPlugins={[remarkGfm]}>{part}</ReactMarkdown>;
                        });
                      })()}
                    </div>
                  </div>

                  <div className="bg-gray-50 border-t border-gray-200 px-10 py-6">
                    <div className="flex items-start gap-4 p-4 bg-amber-50 border border-amber-100 rounded-2xl">
                       <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                       <div>
                          <p className="text-sm font-black text-amber-900">컨설턴트 제언</p>
                          <p className="text-xs text-amber-800 font-medium leading-relaxed mt-1">
                            본 계획서는 입력하신 정보를 바탕으로 시각 자료와 함께 작성된 초안입니다. 
                            선정 확률을 높이기 위해 본인의 실제 경력 증빙 서류와 구체적인 시제품 사진 등을 보완하여 최종 제출하시기 바랍니다.
                          </p>
                       </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-gray-200 mt-12">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center overflow-hidden">
              <img 
                src="https://lh3.googleusercontent.com/d/1VilZqsiVFpS38S-wyzfu91QHJTs9c5Fl" 
                alt="Logo Small" 
                className="w-full h-full object-contain"
              />
            </div>
            <span className="font-black tracking-tighter text-gray-800">지원사업 수석 컨설턴트</span>
          </div>
          <p className="text-[10px] text-gray-400 font-bold">© 2026 TOP-TIER GOV-CONSULTANT. ALL RIGHTS RESERVED.</p>
        </div>
      </footer>
    </div>
  );
}
