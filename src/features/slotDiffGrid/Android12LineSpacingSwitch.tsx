import { Switch } from '@mui/material';
import { styled } from '@mui/material/styles';

// Android 12 風の勝率表示トグル。
// SlotDiffGrid 本体から分離して UI 定義責務を明確化する。
const formatLineSpacingThumbIcon = encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='#ffffff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M7 6h12M7 12h12M7 18h12M3 4v16M3 8l-2-2 2-2M3 16l-2 2 2 2'/></svg>"
);

export const Android12LineSpacingSwitch = styled(Switch)(() => ({
  width: 56,
  height: 32,
  padding: 0,
  '& .MuiSwitch-switchBase': {
    margin: 4,
    padding: 0,
    transform: 'translateX(0px)',
    '&.Mui-checked': {
      transform: 'translateX(24px)',
      color: '#fff',
      '& .MuiSwitch-thumb': {
        backgroundColor: '#2e7d32',
      },
      '& + .MuiSwitch-track': {
        backgroundColor: '#81c784',
        opacity: 1,
      },
    },
    '&.Mui-disabled + .MuiSwitch-track': {
      opacity: 0.45,
    },
  },
  '& .MuiSwitch-thumb': {
    width: 24,
    height: 24,
    boxSizing: 'border-box',
    boxShadow: 'none',
    backgroundColor: '#9e9e9e',
    position: 'relative',
    '&::before': {
      content: '""',
      display: 'block',
      position: 'absolute',
      inset: 0,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center',
      backgroundSize: '16px 16px',
      backgroundImage: `url("data:image/svg+xml;utf8,${formatLineSpacingThumbIcon}")`,
    },
  },
  '& .MuiSwitch-track': {
    borderRadius: 16,
    backgroundColor: '#c5c5c5',
    opacity: 1,
  },
}));
