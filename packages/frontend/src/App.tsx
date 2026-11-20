//-----------------------------------------------------------------------
// <copyright company="Microsoft Corporation">
//        Copyright (c) Microsoft Corporation.  All rights reserved.
//        Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

import {
  FluentProvider,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';

import { useTheme } from './hooks/theme.context';
import { ScheduleApp } from './ScheduleApp';

function App() {
  const { isDark } = useTheme();

  return (
    <FluentProvider theme={{
      ...(isDark ? webDarkTheme : webLightTheme),
      colorBrandBackground: '#117865', colorBrandForeground1: isDark ? '#65cfb9' : '#117865',
      colorCompoundBrandForeground1: isDark ? '#65cfb9' : '#117865',
    }}>
      <ScheduleApp />
    </FluentProvider>
  );
}

export default App;
